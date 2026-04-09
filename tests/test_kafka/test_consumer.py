"""
Unit tests for the Kafka consumer's message-processing path.
Kafka I/O is fully mocked — we test the decision flow and DLQ fallback.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.kafka.consumer import ClaimsKafkaConsumer
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    ClaimAnalysisState,
    FraudDetectionResult,
    RiskLevel,
)


def _make_kafka_message(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        topic="hcx.claims.validated",
        partition=0,
        offset=42,
        headers=[],
        value=payload,
    )


def _make_fake_analysis(sample_claim) -> ClaimAnalysisState:
    return ClaimAnalysisState(
        claim=sample_claim,
        correlation_id=sample_claim.hcx_correlation_id,
        adjudication_decision=AdjudicationDecision.APPROVED,
        overall_confidence=0.9,
        requires_human_review=False,
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED,
            fraud_score=0.1,
            risk_level=RiskLevel.LOW,
        ),
    )


@pytest.mark.asyncio
async def test_process_one_happy_path(sample_claim, raw_fhir_bundle):
    consumer = ClaimsKafkaConsumer()

    fake_producer = MagicMock()
    fake_producer.send_and_wait = AsyncMock()
    fake_consumer = MagicMock()
    fake_consumer.commit = AsyncMock()

    consumer._producer = fake_producer
    consumer._consumer = fake_consumer
    consumer._coordinator = MagicMock()
    consumer._coordinator.process_claim = AsyncMock(
        return_value=_make_fake_analysis(sample_claim)
    )

    message = _make_kafka_message(
        {
            "event_type": "ClaimReceived",
            "schema_version": "1.0",
            "timestamp": "2026-04-09T10:00:00+00:00",
            "payload": raw_fhir_bundle,
            "hcx_headers": {
                "X-HCX-Correlation-ID": sample_claim.hcx_correlation_id,
                "X-HCX-Sender-Code": sample_claim.hcx_sender_code,
                "X-HCX-Recipient-Code": sample_claim.hcx_recipient_code,
                "X-HCX-Workflow-ID": sample_claim.hcx_workflow_id,
                "X-HCX-API-Call-ID": sample_claim.hcx_api_call_id,
            },
        }
    )

    with patch("src.kafka.consumer.AuditService.record", AsyncMock()):
        await consumer._process_one(message)

    fake_producer.send_and_wait.assert_awaited_once()
    call = fake_producer.send_and_wait.await_args
    assert call.args[0] == "hcx.claims.enriched"
    kafka_headers = dict(call.kwargs.get("headers") or [])
    assert b"X-HCX-AI-Recommendation" not in kafka_headers  # stored as tuples
    headers_list = call.kwargs.get("headers") or []
    headers_by_name = {k: v for k, v in headers_list}
    assert headers_by_name.get("X-HCX-AI-Recommendation") == b"approved"
    assert headers_by_name.get("X-HCX-AI-Score") is not None

    fake_consumer.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_process_one_dlq_on_parse_error():
    consumer = ClaimsKafkaConsumer()

    fake_producer = MagicMock()
    fake_producer.send_and_wait = AsyncMock()
    fake_consumer = MagicMock()
    fake_consumer.commit = AsyncMock()

    consumer._producer = fake_producer
    consumer._consumer = fake_consumer

    # Missing `payload` — will raise during KafkaClaimMessage validation
    message = _make_kafka_message({"event_type": "ClaimReceived"})

    with patch("src.kafka.consumer.AuditService.record", AsyncMock()):
        await consumer._process_one(message)

    # DLQ publish was called
    fake_producer.send_and_wait.assert_awaited()
    dlq_call = fake_producer.send_and_wait.await_args
    assert dlq_call.args[0] == "hcx.claims.ai.dlq"
