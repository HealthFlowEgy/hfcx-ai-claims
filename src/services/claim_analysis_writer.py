"""
Claim-analysis writer (P0 review finding).

Every time the Coordinator finishes a claim, we upsert one row into
``ai_claim_analysis`` with:

1. The full agent result JSON blobs (eligibility, coding, fraud,
   necessity) — used by the "claim detail" view.
2. Denormalized claim metadata (provider, payer, claim type, amount,
   patient NID hash + masked display) so the BFF portals can render
   dashboards without joining the HFCX platform ``claims`` table.
3. Derived summary fields (risk_score, recommendation, confidence,
   fraud_score, fraud_risk_level) so dashboard aggregations are fast.

The writer is non-blocking: failures are logged and swallowed so a
database outage can never block a claim from being adjudicated
(SEC-003 / NFR-004). The Kafka consumer and the REST coordinator path
both call ``ClaimAnalysisWriter.persist`` after the graph returns.
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.models.orm import AIClaimAnalysis, create_engine_and_session
from src.models.schemas import ClaimAnalysisState, FHIRClaimBundle

log = structlog.get_logger(__name__)


def _hash_nid(nid: str | None) -> str | None:
    if not nid:
        return None
    return hashlib.sha256(nid.encode()).hexdigest()[:16]


def _mask_nid(nid: str | None) -> str | None:
    if not nid:
        return None
    s = str(nid)
    if len(s) <= 4:
        return "*" * len(s)
    return "*" * (len(s) - 4) + s[-4:]


def _decision_to_recommendation(decision: str | None) -> str | None:
    """Map internal adjudication decision to SRS §5.1 recommendation enum."""
    if decision == "approved":
        return "approve"
    if decision == "denied":
        return "deny"
    if decision in ("pended", "partial"):
        return "investigate"
    return None


class ClaimAnalysisWriter:
    """Thin upsert facade around AIClaimAnalysis."""

    @classmethod
    async def persist(
        cls,
        *,
        claim: FHIRClaimBundle,
        analysis: ClaimAnalysisState,
    ) -> None:
        """
        Upsert one ai_claim_analysis row. Never raises — audit
        semantics match AuditService (logged + swallowed on error).
        """
        try:
            _, session_factory = create_engine_and_session()
        except Exception as exc:  # pragma: no cover — engine unavailable in dev
            log.warning("claim_analysis_writer_engine_unavailable", error=str(exc))
            return

        payload = cls._build_row(claim, analysis)

        try:
            async with session_factory() as session:
                stmt = pg_insert(AIClaimAnalysis).values(**payload)
                # Upsert on (claim_id, correlation_id) so re-processing a
                # claim updates the existing row instead of duplicating.
                update_cols = {
                    k: stmt.excluded[k]
                    for k in payload
                    if k not in ("id", "created_at")
                }
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_claim_correlation",
                    set_=update_cols,
                )
                await session.execute(stmt)
                await session.commit()
        except Exception as exc:
            log.warning(
                "claim_analysis_writer_failed",
                error=str(exc),
                claim_id=claim.claim_id,
            )

    @staticmethod
    def _build_row(
        claim: FHIRClaimBundle,
        analysis: ClaimAnalysisState,
    ) -> dict[str, Any]:
        fraud = analysis.fraud
        eligibility = analysis.eligibility
        coding = analysis.coding
        necessity = analysis.necessity

        def _dump(obj: Any) -> dict[str, Any] | None:
            if obj is None:
                return None
            if hasattr(obj, "model_dump"):
                return obj.model_dump(mode="json")
            return None

        recommendation = _decision_to_recommendation(
            analysis.adjudication_decision.value
            if analysis.adjudication_decision
            else None
        )

        risk = fraud.fraud_score if fraud and fraud.fraud_score is not None else None

        return {
            # Identity
            "claim_id": claim.claim_id,
            "correlation_id": analysis.correlation_id or claim.hcx_correlation_id,
            "hcx_workflow_id": claim.hcx_workflow_id,
            # Denormalized claim metadata
            "provider_id": claim.provider_id,
            "payer_id": claim.payer_id,
            "claim_type": claim.claim_type.value,
            "total_amount": float(claim.total_amount),
            "patient_nid_hash": _hash_nid(claim.patient_id),
            "patient_nid_masked": _mask_nid(claim.patient_id),
            "service_date": claim.service_date,
            # SRS 5.1 exact-spec columns
            "risk_score": round(risk, 2) if risk is not None else None,
            "recommendation": recommendation,
            "confidence": (
                round(analysis.overall_confidence, 2)
                if analysis.overall_confidence is not None
                else None
            ),
            # Agent result JSONB blobs
            "eligibility_result": _dump(eligibility),
            "coding_result": _dump(coding),
            "fraud_result": _dump(fraud),
            "necessity_result": _dump(necessity),
            # Final decision
            "adjudication_decision": (
                analysis.adjudication_decision.value
                if analysis.adjudication_decision
                else None
            ),
            "overall_confidence": analysis.overall_confidence,
            "requires_human_review": analysis.requires_human_review,
            "human_review_reasons": list(analysis.human_review_reasons or []),
            # Denormalized fraud summary
            "fraud_score": fraud.fraud_score if fraud else None,
            "fraud_risk_level": (
                fraud.risk_level.value if fraud and fraud.risk_level else None
            ),
            # Reproducibility
            "model_versions": analysis.model_versions or None,
            # Performance
            "processing_time_ms": (
                analysis.agent_durations_ms.get("total")
                if analysis.agent_durations_ms
                else None
            ),
            # Timestamps
            "completed_at": analysis.completed_at or datetime.now(UTC),
        }
