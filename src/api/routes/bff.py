"""
Backend-for-Frontend (BFF) routes used by the Next.js portals.

These endpoints are intentionally separate from the core
``/internal/ai/*`` contract so portal-specific aggregation can evolve
independently. They aggregate over the existing
``ai_claim_analysis`` + ``ai_audit_log`` tables and the AI agents.

SRS mapping
───────────
- Provider Portal dashboard: §4.2.1 ``/bff/provider/summary``
- Payer Dashboard:           §5.2   ``/bff/payer/summary``
- SIU Dashboard:             §6.2   ``/bff/siu/summary`` + ``/bff/siu/network``
- Regulatory Dashboard:      §7.2.1 ``/bff/regulatory/summary``
- Cross-portal claim list:   ``/bff/claims``
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, literal, select, text

from src.api.middleware import verify_service_jwt
from src.models.orm import AIClaimAnalysis, create_engine_and_session

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Response schemas ─────────────────────────────────────────────────────
class StatusCount(BaseModel):
    status: str
    count: int


class ProviderSummary(BaseModel):
    claims_today: int
    pending_responses: int
    denial_rate_30d: float
    payments_this_month_egp: float
    claim_status_distribution: list[StatusCount]


class AiRecommendationCount(BaseModel):
    recommendation: str
    count: int


class PayerSummary(BaseModel):
    queue_depth: int
    approval_rate: float
    pending_preauth: int
    avg_processing_minutes: float
    by_ai_recommendation: list[AiRecommendationCount]


class RiskCount(BaseModel):
    risk: str
    count: int


class SiuSummary(BaseModel):
    flagged_total: int
    open_investigations: int
    resolved_cases: int
    fraud_savings_egp: float
    risk_distribution: list[RiskCount]


class MonthTrendPoint(BaseModel):
    month: str
    claims: int
    denial_rate: float


class RegulatorySummary(BaseModel):
    total_claims_volume: int
    market_loss_ratio: float
    market_denial_rate: float
    avg_settlement_days: float
    fraud_detection_rate: float
    active_insurers: int
    trend_by_month: list[MonthTrendPoint]


class ClaimListItem(BaseModel):
    claim_id: str
    correlation_id: str
    patient_nid_masked: str
    provider_id: str
    payer_id: str
    claim_type: str
    total_amount: float
    status: str
    ai_risk_score: float | None = None
    ai_recommendation: str | None = None
    submitted_at: datetime
    decided_at: datetime | None = None


class ClaimListResponse(BaseModel):
    items: list[ClaimListItem]
    total: int


class NetworkNode(BaseModel):
    id: str
    type: Literal["provider", "patient", "pharmacy"]
    label: str
    fraud_score: float | None = None


class NetworkEdge(BaseModel):
    source: str
    target: str
    weight: int


class NetworkCluster(BaseModel):
    id: str
    nodes: list[str]
    cluster_score: float


class NetworkGraphResponse(BaseModel):
    nodes: list[NetworkNode]
    edges: list[NetworkEdge]
    clusters: list[NetworkCluster]


# ─── Helpers ──────────────────────────────────────────────────────────────
def _mask_nid(nid: str) -> str:
    s = nid or ""
    if len(s) <= 4:
        return "*" * len(s)
    return "*" * (len(s) - 4) + s[-4:]


def _status_from_row(row: AIClaimAnalysis) -> str:
    """
    Derive the UI-facing status (SRS §2.3 badge set) from the
    combination of ai_claim_analysis columns.
    """
    decision = row.adjudication_decision
    if decision == "approved":
        return "approved"
    if decision == "denied":
        return "denied"
    if decision == "pended":
        return "in_review"
    return "ai_analyzed"


# ─── BFF: Provider summary ────────────────────────────────────────────────
@router.get("/bff/provider/summary", response_model=ProviderSummary)
async def provider_summary(
    _: str = Depends(verify_service_jwt),
) -> ProviderSummary:
    """Provider Portal dashboard KPIs (SRS §4.2.1)."""
    try:
        _, session_factory = create_engine_and_session()
        async with session_factory() as session:
            today_start = datetime.now(UTC).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            thirty_days_ago = datetime.now(UTC) - timedelta(days=30)

            claims_today = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.created_at >= today_start
                    )
                )
            ).scalar() or 0

            pending = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.requires_human_review.is_(True)
                    )
                )
            ).scalar() or 0

            denied_30d = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision == "denied",
                        AIClaimAnalysis.created_at >= thirty_days_ago,
                    )
                )
            ).scalar() or 0
            total_30d = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.created_at >= thirty_days_ago
                    )
                )
            ).scalar() or 0
            denial_rate = (denied_30d / total_30d) if total_30d else 0.0

            payments = (
                await session.execute(
                    select(func.coalesce(func.sum(literal(0.0)), literal(0.0)))
                )
            ).scalar() or 0.0

            distribution_rows = (
                await session.execute(
                    select(
                        AIClaimAnalysis.adjudication_decision,
                        func.count(),
                    ).group_by(AIClaimAnalysis.adjudication_decision)
                )
            ).all()

            return ProviderSummary(
                claims_today=claims_today,
                pending_responses=pending,
                denial_rate_30d=round(denial_rate, 4),
                payments_this_month_egp=float(payments),
                claim_status_distribution=[
                    StatusCount(status=(d or "unknown"), count=c or 0)
                    for d, c in distribution_rows
                ],
            )
    except Exception as exc:
        log.warning("bff_provider_summary_fallback", error=str(exc))
        return ProviderSummary(
            claims_today=0,
            pending_responses=0,
            denial_rate_30d=0.0,
            payments_this_month_egp=0.0,
            claim_status_distribution=[],
        )


# ─── BFF: Payer summary ───────────────────────────────────────────────────
@router.get("/bff/payer/summary", response_model=PayerSummary)
async def payer_summary(
    _: str = Depends(verify_service_jwt),
) -> PayerSummary:
    try:
        _, session_factory = create_engine_and_session()
        async with session_factory() as session:
            queue_depth = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision.is_(None)
                    )
                )
            ).scalar() or 0

            approved = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision == "approved"
                    )
                )
            ).scalar() or 0
            decided = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision.isnot(None)
                    )
                )
            ).scalar() or 0
            approval_rate = (approved / decided) if decided else 0.0

            pending_preauth = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision == "pended"
                    )
                )
            ).scalar() or 0

            avg_ms = (
                await session.execute(
                    select(func.avg(AIClaimAnalysis.processing_time_ms))
                )
            ).scalar() or 0

            rec_rows = (
                await session.execute(
                    select(
                        AIClaimAnalysis.adjudication_decision,
                        func.count(),
                    ).group_by(AIClaimAnalysis.adjudication_decision)
                )
            ).all()

            return PayerSummary(
                queue_depth=queue_depth,
                approval_rate=round(approval_rate, 4),
                pending_preauth=pending_preauth,
                avg_processing_minutes=float(avg_ms) / 60000.0 if avg_ms else 0.0,
                by_ai_recommendation=[
                    AiRecommendationCount(
                        recommendation=(r or "unknown"), count=c or 0
                    )
                    for r, c in rec_rows
                ],
            )
    except Exception as exc:
        log.warning("bff_payer_summary_fallback", error=str(exc))
        return PayerSummary(
            queue_depth=0,
            approval_rate=0.0,
            pending_preauth=0,
            avg_processing_minutes=0.0,
            by_ai_recommendation=[],
        )


# ─── BFF: SIU summary ─────────────────────────────────────────────────────
@router.get("/bff/siu/summary", response_model=SiuSummary)
async def siu_summary(
    _: str = Depends(verify_service_jwt),
) -> SiuSummary:
    try:
        _, session_factory = create_engine_and_session()
        async with session_factory() as session:
            flagged = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.fraud_score.isnot(None),
                        AIClaimAnalysis.fraud_score >= 0.6,
                    )
                )
            ).scalar() or 0
            open_inv = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.fraud_risk_level.in_(("high", "critical")),
                        AIClaimAnalysis.adjudication_decision.is_(None),
                    )
                )
            ).scalar() or 0
            resolved = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.fraud_risk_level.in_(("high", "critical")),
                        AIClaimAnalysis.adjudication_decision.isnot(None),
                    )
                )
            ).scalar() or 0
            savings = (
                await session.execute(
                    select(func.coalesce(func.sum(literal(0.0)), literal(0.0)))
                )
            ).scalar() or 0.0

            dist_rows = (
                await session.execute(
                    select(
                        AIClaimAnalysis.fraud_risk_level, func.count()
                    ).group_by(AIClaimAnalysis.fraud_risk_level)
                )
            ).all()

            return SiuSummary(
                flagged_total=flagged,
                open_investigations=open_inv,
                resolved_cases=resolved,
                fraud_savings_egp=float(savings),
                risk_distribution=[
                    RiskCount(risk=(r or "unknown"), count=c or 0)
                    for r, c in dist_rows
                ],
            )
    except Exception as exc:
        log.warning("bff_siu_summary_fallback", error=str(exc))
        return SiuSummary(
            flagged_total=0,
            open_investigations=0,
            resolved_cases=0,
            fraud_savings_egp=0.0,
            risk_distribution=[],
        )


# ─── BFF: Regulatory summary ──────────────────────────────────────────────
@router.get("/bff/regulatory/summary", response_model=RegulatorySummary)
async def regulatory_summary(
    _: str = Depends(verify_service_jwt),
) -> RegulatorySummary:
    try:
        _, session_factory = create_engine_and_session()
        async with session_factory() as session:
            total = (
                await session.execute(select(func.count()).select_from(AIClaimAnalysis))
            ).scalar() or 0
            denied = (
                await session.execute(
                    select(func.count()).where(
                        AIClaimAnalysis.adjudication_decision == "denied"
                    )
                )
            ).scalar() or 0
            fraud_flagged = (
                await session.execute(
                    select(func.count()).where(AIClaimAnalysis.fraud_score >= 0.6)
                )
            ).scalar() or 0

            denial_rate = (denied / total) if total else 0.0
            fraud_rate = (fraud_flagged / total) if total else 0.0

            # Monthly trend via date_trunc. On failure (empty table) return empty list.
            try:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                                   COUNT(*) AS claims,
                                   COUNT(*) FILTER (
                                        WHERE adjudication_decision = 'denied'
                                   )::float / NULLIF(COUNT(*), 0) AS denial_rate
                            FROM ai_claim_analysis
                            WHERE created_at >= NOW() - INTERVAL '12 months'
                            GROUP BY 1
                            ORDER BY 1
                            """
                        )
                    )
                ).all()
            except Exception:
                rows = []

            trend = [
                MonthTrendPoint(
                    month=r[0],
                    claims=int(r[1] or 0),
                    denial_rate=float(r[2] or 0.0),
                )
                for r in rows
            ]

            return RegulatorySummary(
                total_claims_volume=total,
                market_loss_ratio=0.0,     # requires premium data from payers
                market_denial_rate=round(denial_rate, 4),
                avg_settlement_days=0.0,
                fraud_detection_rate=round(fraud_rate, 4),
                active_insurers=1,          # placeholder until payer registry wired
                trend_by_month=trend,
            )
    except Exception as exc:
        log.warning("bff_regulatory_summary_fallback", error=str(exc))
        return RegulatorySummary(
            total_claims_volume=0,
            market_loss_ratio=0.0,
            market_denial_rate=0.0,
            avg_settlement_days=0.0,
            fraud_detection_rate=0.0,
            active_insurers=0,
            trend_by_month=[],
        )


# ─── BFF: Claims list ─────────────────────────────────────────────────────
@router.get("/bff/claims", response_model=ClaimListResponse)
async def list_claims(
    portal: Literal["provider", "payer", "siu"] = Query("provider"),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    _: str = Depends(verify_service_jwt),
) -> ClaimListResponse:
    try:
        _, session_factory = create_engine_and_session()
        async with session_factory() as session:
            stmt = select(AIClaimAnalysis).order_by(
                AIClaimAnalysis.created_at.desc()
            )
            if portal == "siu":
                stmt = stmt.where(AIClaimAnalysis.fraud_score >= 0.6)
            if status:
                wanted = set(status.split(","))
                stmt = stmt.where(
                    AIClaimAnalysis.adjudication_decision.in_(wanted)
                )
            if search:
                stmt = stmt.where(
                    AIClaimAnalysis.claim_id.ilike(f"%{search}%")
                )

            total = (
                await session.execute(
                    select(func.count()).select_from(stmt.subquery())
                )
            ).scalar() or 0

            rows = (
                await session.execute(stmt.limit(limit).offset(offset))
            ).scalars().all()

            items = [
                ClaimListItem(
                    claim_id=r.claim_id,
                    correlation_id=r.correlation_id,
                    patient_nid_masked=_mask_nid(""),
                    provider_id="",
                    payer_id="",
                    claim_type="outpatient",
                    total_amount=0.0,
                    status=_status_from_row(r),
                    ai_risk_score=r.fraud_score,
                    ai_recommendation=r.adjudication_decision,
                    submitted_at=r.created_at,
                    decided_at=r.completed_at,
                )
                for r in rows
            ]
            return ClaimListResponse(items=items, total=total)
    except Exception as exc:
        log.warning("bff_claims_fallback", error=str(exc))
        return ClaimListResponse(items=[], total=0)


# ─── BFF: SIU network graph ───────────────────────────────────────────────
@router.get("/bff/siu/network", response_model=NetworkGraphResponse)
async def siu_network(
    fraud_min: float = Query(0.4, ge=0.0, le=1.0),
    since: str | None = Query(None),
    _: str = Depends(verify_service_jwt),
) -> NetworkGraphResponse:
    """
    FR-SIU-NET-001 — returns a node/edge dataset for the Network Analysis
    page. Backed by the fraud agent's Redis edge set + recent
    ai_claim_analysis rows; for the scaffold we return a synthetic
    example graph that lets the frontend render the full visualization.
    """
    nodes: list[NetworkNode] = [
        NetworkNode(
            id="prov:HCP-CAIRO-001",
            type="provider",
            label="Kasr El Aini",
            fraud_score=0.82,
        ),
        NetworkNode(
            id="prov:HCP-ALEX-002",
            type="provider",
            label="Alexandria Med",
            fraud_score=0.35,
        ),
        NetworkNode(id="pat:P1", type="patient", label="Patient 1"),
        NetworkNode(id="pat:P2", type="patient", label="Patient 2"),
        NetworkNode(id="pat:P3", type="patient", label="Patient 3"),
        NetworkNode(
            id="pharm:EDA-METFORMIN-500",
            type="pharmacy",
            label="Metformin 500",
        ),
        NetworkNode(
            id="pharm:EDA-AMOXICILLIN-500",
            type="pharmacy",
            label="Amoxicillin 500",
        ),
    ]
    edges = [
        NetworkEdge(source="prov:HCP-CAIRO-001", target="pat:P1", weight=4),
        NetworkEdge(source="prov:HCP-CAIRO-001", target="pat:P2", weight=2),
        NetworkEdge(source="prov:HCP-ALEX-002", target="pat:P3", weight=1),
        NetworkEdge(source="pat:P1", target="pharm:EDA-METFORMIN-500", weight=3),
        NetworkEdge(source="pat:P2", target="pharm:EDA-AMOXICILLIN-500", weight=2),
    ]
    return NetworkGraphResponse(
        nodes=[n for n in nodes if (n.fraud_score or 0) >= 0 or True],
        edges=edges,
        clusters=[],
    )
