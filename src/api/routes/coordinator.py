"""
POST /internal/ai/coordinate — Submit FHIR Claim for AI orchestration
POST /internal/ai/coordinate/async — Async submit (returns immediately)
GET  /internal/ai/coordinate/status/{claim_id} — Poll for result
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.agents.coordinator import get_coordinator
from src.api.middleware import verify_service_jwt
from src.models.schemas import (
    AdjudicationDecision,
    AICoordinateRequest,
    AICoordinateResponse,
    FHIRClaimBundle,
)
from src.services.claim_analysis_writer import ClaimAnalysisWriter
from src.services.redis_service import get_redis_pool
from src.utils.fhir_parser import FHIRClaimParser

log = structlog.get_logger(__name__)
router = APIRouter()

# Parser is stateless — safe to share.
_parser = FHIRClaimParser()

# ── In-memory task tracker for async submissions ─────────────────────
# Maps claim_id → {"status": "processing"|"completed"|"failed", "result": ..., "error": ...}
_async_tasks: dict[str, dict[str, Any]] = {}


class AsyncSubmitResponse(BaseModel):
    """Returned immediately by the async coordinate endpoint."""
    claim_id: str
    status: str = "processing"
    message: str = "Claim submitted for AI analysis. Poll for results."


class ClaimStatusResponse(BaseModel):
    """Returned by the status polling endpoint."""
    claim_id: str
    status: str  # "processing" | "completed" | "failed"
    result: AICoordinateResponse | None = None
    error: str | None = None


# ── Synchronous endpoint (original) ─────────────────────────────────

@router.post(
    "/coordinate",
    response_model=AICoordinateResponse,
    summary="Submit FHIR Claim for AI Analysis (synchronous)",
    description=(
        "Accepts a FHIR R4 Claim bundle and runs multi-agent AI adjudication. "
        "Returns enriched claim with eligibility, coding, fraud, and necessity "
        "assessments. WARNING: may take 3-5 minutes for self-hosted models."
    ),
)
async def coordinate_claim(
    request: AICoordinateRequest,
    _: str = Depends(verify_service_jwt),
) -> AICoordinateResponse:
    coordinator = get_coordinator()

    try:
        claim: FHIRClaimBundle = _parser.parse(
            raw_bundle=request.fhir_claim_bundle,
            hcx_headers=request.hcx_headers,
        )
    except Exception as exc:
        log.error("fhir_parse_error", error=str(exc))
        raise HTTPException(
            status_code=422, detail=f"FHIR bundle parse error: {exc}"
        ) from exc

    t0 = time.monotonic()
    try:
        analysis = await coordinator.process_claim(claim)
    except Exception as exc:
        log.error("coordinator_rest_failed", error=str(exc), exc_info=True)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "ERR-AI-503",
                "message": (
                    "AI layer unavailable — retry later or route to manual queue"
                ),
                "correlation_id": claim.hcx_correlation_id,
            },
        ) from exc
    processing_ms = int((time.monotonic() - t0) * 1000)

    await ClaimAnalysisWriter.persist(claim=claim, analysis=analysis)

    return AICoordinateResponse(
        correlation_id=analysis.correlation_id,
        claim_id=claim.claim_id,
        adjudication_decision=analysis.adjudication_decision,
        overall_confidence=analysis.overall_confidence or 0.0,
        requires_human_review=analysis.requires_human_review,
        human_review_reasons=analysis.human_review_reasons,
        eligibility=analysis.eligibility,
        coding=analysis.coding,
        fraud=analysis.fraud,
        necessity=analysis.necessity,
        processing_time_ms=processing_ms,
        model_versions=analysis.model_versions,
        fhir_extensions=[],
    )


# ── Redis pub/sub for SSE real-time updates ───────────────────────────

CLAIM_UPDATES_CHANNEL = "hfcx:claim:updates"


async def _publish_claim_update(
    claim_id: str,
    status: str,
    decision: str | None = None,
    confidence: float | None = None,
    error: str | None = None,
) -> None:
    """Publish a claim status update to Redis pub/sub for SSE consumers."""
    import redis.asyncio as aioredis

    try:
        pool = get_redis_pool()
        client = aioredis.Redis(connection_pool=pool)
        payload = {
            "event": "claim_update",
            "claim_id": claim_id,
            "status": status,
        }
        if decision is not None:
            payload["decision"] = decision
        if confidence is not None:
            payload["confidence"] = str(round(confidence, 4))
        if error is not None:
            payload["error"] = error
        await client.publish(CLAIM_UPDATES_CHANNEL, json.dumps(payload))
        log.info(
            "claim_update_published",
            claim_id=claim_id,
            status=status,
        )
    except Exception as exc:
        # Non-critical — log and continue. The polling fallback
        # still works even if pub/sub fails.
        log.warning(
            "claim_update_publish_failed",
            claim_id=claim_id,
            error=str(exc),
        )


# ── Async submission endpoint ────────────────────────────────────────

async def _process_claim_background(claim_id: str, claim: FHIRClaimBundle) -> None:
    """Background task that processes the claim and stores the result."""
    coordinator = get_coordinator()
    t0 = time.monotonic()
    try:
        analysis = await coordinator.process_claim(claim)
        processing_ms = int((time.monotonic() - t0) * 1000)

        await ClaimAnalysisWriter.persist(claim=claim, analysis=analysis)

        _async_tasks[claim_id] = {
            "status": "completed",
            "result": AICoordinateResponse(
                correlation_id=analysis.correlation_id,
                claim_id=claim.claim_id,
                adjudication_decision=analysis.adjudication_decision,
                overall_confidence=analysis.overall_confidence or 0.0,
                requires_human_review=analysis.requires_human_review,
                human_review_reasons=analysis.human_review_reasons,
                eligibility=analysis.eligibility,
                coding=analysis.coding,
                fraud=analysis.fraud,
                necessity=analysis.necessity,
                processing_time_ms=processing_ms,
                model_versions=analysis.model_versions,
                fhir_extensions=[],
            ),
        }
        log.info(
            "async_claim_completed",
            claim_id=claim_id,
            processing_ms=processing_ms,
        )

        # Publish to Redis so SSE clients (Payer Portal) get
        # real-time notification that a new claim result is ready.
        await _publish_claim_update(
            claim_id=claim_id,
            status="completed",
            decision=analysis.adjudication_decision,
            confidence=analysis.overall_confidence or 0.0,
        )
    except Exception as exc:
        log.error(
            "async_claim_failed",
            claim_id=claim_id,
            error=str(exc),
            exc_info=True,
        )
        _async_tasks[claim_id] = {
            "status": "failed",
            "error": str(exc),
        }
        await _publish_claim_update(
            claim_id=claim_id,
            status="failed",
            error=str(exc),
        )


@router.post(
    "/coordinate/async",
    response_model=AsyncSubmitResponse,
    summary="Submit FHIR Claim for AI Analysis (async)",
    description=(
        "Accepts a FHIR R4 Claim bundle and immediately returns a claim ID. "
        "The AI analysis runs in the background. Poll /coordinate/status/{claim_id} "
        "for results."
    ),
)
async def coordinate_claim_async(
    request: AICoordinateRequest,
    _: str = Depends(verify_service_jwt),
) -> AsyncSubmitResponse:
    try:
        claim: FHIRClaimBundle = _parser.parse(
            raw_bundle=request.fhir_claim_bundle,
            hcx_headers=request.hcx_headers,
        )
    except Exception as exc:
        log.error("fhir_parse_error", error=str(exc))
        raise HTTPException(
            status_code=422, detail=f"FHIR bundle parse error: {exc}"
        ) from exc

    claim_id = claim.claim_id or f"CLAIM-{uuid.uuid4().hex[:12]}"

    # Register the task as processing
    _async_tasks[claim_id] = {"status": "processing"}

    # Fire-and-forget the background processing
    asyncio.create_task(_process_claim_background(claim_id, claim))

    log.info("async_claim_submitted", claim_id=claim_id)
    return AsyncSubmitResponse(
        claim_id=claim_id,
        status="processing",
        message=f"Claim {claim_id} submitted. Poll /status/{claim_id}.",
    )


@router.get(
    "/coordinate/status/{claim_id}",
    response_model=ClaimStatusResponse,
    summary="Poll claim processing status",
    description="Returns the current status and result of an async claim submission.",
)
async def coordinate_claim_status(
    claim_id: str,
    _: str = Depends(verify_service_jwt),
) -> ClaimStatusResponse:
    task = _async_tasks.get(claim_id)

    if task is None:
        # Not in memory — check the database (may have been processed by another pod)
        try:
            from sqlalchemy import select

            from src.models.orm import AIClaimAnalysis, create_engine_and_session

            _, session_factory = create_engine_and_session()
            async with session_factory() as session:
                stmt = select(AIClaimAnalysis).where(
                    AIClaimAnalysis.claim_id == claim_id
                ).order_by(AIClaimAnalysis.created_at.desc()).limit(1)
                row = (await session.execute(stmt)).scalar_one_or_none()

                if row and row.completed_at:
                    return ClaimStatusResponse(
                        claim_id=claim_id,
                        status="completed",
                        result=AICoordinateResponse(
                            correlation_id=row.correlation_id or "",
                            claim_id=row.claim_id,
                            adjudication_decision=(
                                AdjudicationDecision(row.adjudication_decision)
                                if row.adjudication_decision
                                else AdjudicationDecision.PENDED
                            ),
                            overall_confidence=row.overall_confidence or 0.0,
                            requires_human_review=row.requires_human_review or True,
                            human_review_reasons=row.human_review_reasons or [],
                            eligibility=row.eligibility_result,
                            coding=row.coding_result,
                            fraud=row.fraud_result,
                            necessity=row.necessity_result,
                            processing_time_ms=row.processing_time_ms or 0,
                            model_versions=row.model_versions or {},
                            fhir_extensions=[],
                        ),
                    )
                elif row:
                    return ClaimStatusResponse(
                        claim_id=claim_id,
                        status="processing",
                    )
        except Exception as exc:
            log.warning("status_db_check_failed", claim_id=claim_id, error=str(exc))

        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    if task["status"] == "completed":
        return ClaimStatusResponse(
            claim_id=claim_id,
            status="completed",
            result=task["result"],
        )
    elif task["status"] == "failed":
        return ClaimStatusResponse(
            claim_id=claim_id,
            status="failed",
            error=task.get("error", "Unknown error"),
        )
    else:
        return ClaimStatusResponse(
            claim_id=claim_id,
            status="processing",
        )
