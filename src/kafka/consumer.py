"""
Kafka Consumer — hcx.claims.validated topic consumer.

This is the primary integration point with the existing HFCX platform.
hcx-pipeline-jobs (Scala) publishes ClaimReceived events after FHIR validation;
this consumer picks them up, runs AI analysis, and publishes EnrichedClaim
events.

Architecture (SRS 3.1 — Additive, Not Replacement):
  Existing: API Gateway → HCX APIs → FHIR Validation → Pipeline Jobs → hcx.claims.validated
  New AI:   hcx.claims.validated → [THIS] → Coordinator Agent → hcx.claims.enriched
  Existing: hcx.claims.enriched → Pipeline Jobs (Scala) → Payer callback
"""
from __future__ import annotations

import asyncio
import json
import signal
from datetime import UTC, datetime

import structlog
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from opentelemetry import context as otel_context
from opentelemetry import propagate, trace

from src.agents.coordinator import get_coordinator, shutdown_coordinator
from src.config import get_settings
from src.models.schemas import (
    ClaimAnalysisState,
    FHIRClaimBundle,
    KafkaClaimMessage,
    KafkaEnrichedClaimMessage,
)
from src.services.audit_service import AuditService
from src.services.claim_analysis_writer import ClaimAnalysisWriter
from src.utils.fhir_parser import FHIRClaimParser
from src.utils.metrics import (
    KAFKA_CONSUMER_LAG,
    KAFKA_DLQ_MESSAGES,
    KAFKA_MESSAGES_CONSUMED,
    KAFKA_MESSAGES_PRODUCED,
)

log = structlog.get_logger(__name__)
settings = get_settings()
tracer = trace.get_tracer("hfcx_ai_claims.kafka")


class ClaimsKafkaConsumer:
    """
    Main Kafka consumer loop. Runs as a long-lived asyncio task.

    Message flow:
    1. Consume from hcx.claims.validated
    2. Parse FHIR bundle (FHIRClaimParser)
    3. Run CoordinatorAgent.process_claim()  (singleton)
    4. Serialize result as KafkaEnrichedClaimMessage
    5. Publish to hcx.claims.enriched
    6. On failure: publish to hcx.claims.ai.dlq (dead letter queue)
    """

    def __init__(self) -> None:
        self._coordinator = get_coordinator()
        self._fhir_parser = FHIRClaimParser()
        self._consumer: AIOKafkaConsumer | None = None
        self._producer: AIOKafkaProducer | None = None
        self._running = False

    async def start(self) -> None:
        self._consumer = AIOKafkaConsumer(
            settings.kafka_topic_claims_validated,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=settings.kafka_consumer_group,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            max_poll_records=settings.kafka_max_poll_records,
            session_timeout_ms=settings.kafka_session_timeout_ms,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )

        self._producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            compression_type="gzip",
            acks="all",
            enable_idempotence=True,
        )

        await self._consumer.start()
        await self._producer.start()
        await AuditService.start()
        await self._coordinator.ensure_ready()
        self._running = True
        log.info(
            "kafka_consumer_started",
            topic=settings.kafka_topic_claims_validated,
            group=settings.kafka_consumer_group,
        )

    async def stop(self) -> None:
        self._running = False
        if self._consumer:
            await self._consumer.stop()
        if self._producer:
            await self._producer.stop()
        await AuditService.stop()
        await shutdown_coordinator()
        log.info("kafka_consumer_stopped")

    async def run(self) -> None:
        """Main message processing loop."""
        if not self._consumer or not self._producer:
            raise RuntimeError("Consumer not started. Call start() first.")

        async for message in self._consumer:
            if not self._running:
                break

            # NFR-006: propagate distributed trace context across Kafka.
            headers = {
                (k or ""): (v.decode("utf-8") if isinstance(v, bytes) else v)
                for k, v in (message.headers or [])
            }
            ctx = propagate.extract(headers)
            token = otel_context.attach(ctx)
            try:
                with tracer.start_as_current_span(
                    "hfcx_ai.consume_claim",
                    attributes={
                        "messaging.system": "kafka",
                        "messaging.destination": message.topic,
                        "messaging.kafka.partition": message.partition,
                    },
                ):
                    await self._process_one(message)
            finally:
                otel_context.detach(token)

            # Update lag gauge for HPA hint
            try:
                lag = await self._consumer.end_offsets(
                    [p for p in self._consumer.assignment()]
                )
                KAFKA_CONSUMER_LAG.set(
                    max(
                        (
                            lag[tp] - (message.offset + 1)
                            for tp in lag
                            if tp.partition == message.partition
                        ),
                        default=0,
                    )
                )
            except Exception:
                pass

    async def _process_one(self, message) -> None:
        correlation_id = "unknown"
        claim_id = "unknown"
        try:
            raw_msg: dict = message.value
            kafka_msg = KafkaClaimMessage(**raw_msg)
            correlation_id = kafka_msg.hcx_headers.get(
                "X-HCX-Correlation-ID", "unknown"
            )

            log.info(
                "claim_received",
                correlation_id=correlation_id,
                topic=message.topic,
                partition=message.partition,
                offset=message.offset,
            )

            # Parse FHIR bundle
            claim: FHIRClaimBundle = self._fhir_parser.parse(
                raw_bundle=kafka_msg.payload,
                hcx_headers=kafka_msg.hcx_headers,
            )
            claim_id = claim.claim_id

            # Run AI analysis (singleton coordinator, hot graph)
            analysis: ClaimAnalysisState = await self._coordinator.process_claim(claim)

            # Persist the full AI analysis row so BFF dashboards see real
            # data (P0 review finding). Non-blocking — failures log only.
            await ClaimAnalysisWriter.persist(claim=claim, analysis=analysis)

            # Build enriched message
            enriched = KafkaEnrichedClaimMessage(
                correlation_id=correlation_id,
                claim_id=claim.claim_id,
                hcx_headers=kafka_msg.hcx_headers,
                payload=kafka_msg.payload,
                ai_analysis=analysis.model_dump(mode="json"),
                fhir_extensions=self._build_fhir_extensions(analysis),
            )

            # SRS §3.4 protocol extension headers
            ai_score = (
                f"{analysis.fraud.fraud_score:.2f}"
                if (analysis.fraud and analysis.fraud.fraud_score is not None)
                else "0.00"
            )
            ai_recommendation = (
                analysis.adjudication_decision.value
                if analysis.adjudication_decision
                else "pending"
            )

            # Propagate trace context to downstream consumers.
            out_headers: dict[str, str] = {}
            propagate.inject(out_headers)
            kafka_headers = [
                ("X-HCX-Correlation-ID", correlation_id.encode()),
                ("X-HCX-AI-Score", ai_score.encode()),
                ("X-HCX-AI-Recommendation", ai_recommendation.encode()),
                ("X-HCX-AI-Confidence", str(analysis.overall_confidence or 0.0).encode()),
                ("X-HCX-AI-Version", settings.app_version.encode()),
            ]
            for k, v in out_headers.items():
                kafka_headers.append((k, v.encode()))

            await self._producer.send_and_wait(
                settings.kafka_topic_claims_enriched,
                value=enriched.model_dump(mode="json"),
                key=correlation_id.encode(),
                headers=kafka_headers,
            )

            KAFKA_MESSAGES_CONSUMED.inc()
            KAFKA_MESSAGES_PRODUCED.inc()
            await self._consumer.commit()

            await AuditService.record(
                event_type="ai.enriched",
                correlation_id=correlation_id,
                claim_id=claim.claim_id,
                agent_name="kafka_consumer",
                action="publish_enriched",
                outcome="ok",
                decision=(
                    analysis.adjudication_decision.value
                    if analysis.adjudication_decision
                    else None
                ),
            )

            log.info(
                "claim_enriched_published",
                correlation_id=correlation_id,
                decision=analysis.adjudication_decision,
                confidence=analysis.overall_confidence,
            )

        except Exception as exc:
            log.error(
                "claim_processing_failed",
                correlation_id=correlation_id,
                claim_id=claim_id,
                error=str(exc),
                exc_info=True,
            )
            await self._publish_to_dlq(message, str(exc))
            KAFKA_DLQ_MESSAGES.inc()
            if self._consumer:
                await self._consumer.commit()
            await AuditService.record(
                event_type="ai.failed",
                correlation_id=correlation_id,
                claim_id=claim_id,
                agent_name="kafka_consumer",
                action="process",
                outcome="dlq",
                detail={"error": str(exc)},
            )

    async def _publish_to_dlq(self, original_message, error_message: str) -> None:
        """Publish failed message to dead letter queue for manual processing."""
        if not self._producer:
            return
        try:
            dlq_payload = {
                "original_topic": original_message.topic,
                "original_partition": original_message.partition,
                "original_offset": original_message.offset,
                "original_value": original_message.value,
                "error": error_message,
                "failed_at": datetime.now(UTC).isoformat(),
                "ai_layer_version": settings.app_version,
            }
            await self._producer.send_and_wait(
                settings.kafka_topic_dlq,
                value=dlq_payload,
            )
        except Exception as exc:
            log.error("dlq_publish_failed", error=str(exc))

    def _build_fhir_extensions(
        self, analysis: ClaimAnalysisState
    ) -> list[dict]:
        """
        Build FHIR ClaimResponse.extension[] entries from AI analysis results.
        These extensions carry AI results back through the HFCX protocol to payers.
        Format follows FHIR R4 Extension spec (SRS Section 5.1, Appendix B).
        """
        extensions: list[dict] = []
        base_url = "https://healthflow.io/fhir/StructureDefinition/ai-claim"

        if analysis.adjudication_decision:
            extensions.append(
                {
                    "url": f"{base_url}-adjudication",
                    "valueCode": analysis.adjudication_decision.value,
                }
            )

        if analysis.overall_confidence is not None:
            extensions.append(
                {
                    "url": f"{base_url}-confidence",
                    "valueDecimal": round(analysis.overall_confidence, 4),
                }
            )

        if analysis.fraud and analysis.fraud.fraud_score is not None:
            extensions.append(
                {
                    "url": f"{base_url}-fraud-risk",
                    "valueCode": (
                        analysis.fraud.risk_level.value
                        if analysis.fraud.risk_level
                        else "unknown"
                    ),
                }
            )
            extensions.append(
                {
                    "url": f"{base_url}-fraud-score",
                    "valueDecimal": round(analysis.fraud.fraud_score, 4),
                }
            )
            if analysis.fraud.explanation:
                extensions.append(
                    {
                        "url": f"{base_url}-fraud-explanation",
                        "valueString": analysis.fraud.explanation,
                    }
                )

        if analysis.coding is not None:
            extensions.append(
                {
                    "url": f"{base_url}-coding-valid",
                    "valueBoolean": bool(analysis.coding.all_codes_valid),
                }
            )
            if analysis.coding.confidence_score is not None:
                extensions.append(
                    {
                        "url": f"{base_url}-coding-confidence",
                        "valueDecimal": round(analysis.coding.confidence_score, 4),
                    }
                )

        if analysis.eligibility is not None:
            extensions.append(
                {
                    "url": f"{base_url}-eligibility",
                    "valueBoolean": bool(analysis.eligibility.is_eligible),
                }
            )

        extensions.append(
            {
                "url": f"{base_url}-requires-review",
                "valueBoolean": analysis.requires_human_review,
            }
        )

        if analysis.necessity and analysis.necessity.arabic_summary:
            extensions.append(
                {
                    "url": f"{base_url}-necessity-summary-ar",
                    "valueString": analysis.necessity.arabic_summary,
                }
            )

        return extensions


# ─────────────────────────────────────────────────────────────────────────────
# Entry point for standalone consumer process
# ─────────────────────────────────────────────────────────────────────────────

async def run_consumer() -> None:
    consumer = ClaimsKafkaConsumer()
    await consumer.start()

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _signal_handler() -> None:
        log.info("shutdown_signal_received")
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _signal_handler)

    try:
        consumer_task = asyncio.create_task(consumer.run())
        await stop_event.wait()
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass
    finally:
        await consumer.stop()
        log.info("kafka_consumer_shutdown_complete")


if __name__ == "__main__":
    asyncio.run(run_consumer())
