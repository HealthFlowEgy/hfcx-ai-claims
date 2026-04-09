"""
POST /internal/ai/coordinate — Submit FHIR Claim for AI orchestration
"""
from __future__ import annotations

import time

import structlog
from fastapi import APIRouter, Depends, HTTPException

from src.agents.coordinator import get_coordinator
from src.api.middleware import verify_service_jwt
from src.models.schemas import (
    AICoordinateRequest,
    AICoordinateResponse,
    FHIRClaimBundle,
)
from src.utils.fhir_parser import FHIRClaimParser

log = structlog.get_logger(__name__)
router = APIRouter()

# Parser is stateless — safe to share.
_parser = FHIRClaimParser()


@router.post(
    "/coordinate",
    response_model=AICoordinateResponse,
    summary="Submit FHIR Claim for AI Analysis",
    description=(
        "Accepts a FHIR R4 Claim bundle and runs multi-agent AI adjudication. "
        "Returns enriched claim with eligibility, coding, fraud, and necessity "
        "assessments."
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
        # NFR-004 graceful degradation: surface as 503 with correlation ID
        # rather than leaking a 500. The Kafka consumer path has its own
        # bypass-on-failure branch; the REST path is operator-facing so
        # a clear error is more useful.
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
