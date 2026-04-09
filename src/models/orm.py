"""
SQLAlchemy ORM — ai_claim_analysis, ai_agent_memory, ai_audit_log
Matches SRS Section 5 data model.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.config import get_settings


class Base(AsyncAttrs, DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ─────────────────────────────────────────────────────────────────────────────
# ai_claim_analysis (SRS 5.1)
# ─────────────────────────────────────────────────────────────────────────────
class AIClaimAnalysis(Base):
    """
    Primary AI analysis record — one row per claim processed.
    Extended as FHIR ClaimResponse.extension[] when returned to payer.
    """
    __tablename__ = "ai_claim_analysis"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id = Column(String(128), nullable=False, index=True)
    correlation_id = Column(String(128), nullable=False, index=True)
    hcx_workflow_id = Column(String(128), nullable=True)

    # ── Claim metadata (denormalized from FHIR bundle) ────────────────
    # These columns are populated by the claim-analysis writer so the
    # BFF layer can power dashboards without joining the HFCX platform
    # claims table cross-service. SEC-005: patient_id is stored as a
    # SHA-256 hash only; the masked NID is a display aid, not the truth.
    provider_id = Column(String(128), nullable=True, index=True)
    payer_id = Column(String(128), nullable=True, index=True)
    claim_type = Column(String(32), nullable=True, index=True)
    total_amount = Column(Numeric(14, 2), nullable=True)
    patient_nid_hash = Column(String(64), nullable=True, index=True)
    patient_nid_masked = Column(String(32), nullable=True)
    service_date = Column(DateTime(timezone=True), nullable=True)

    # SRS 5.1 exact-spec columns
    risk_score = Column(Numeric(3, 2), nullable=True)
    recommendation = Column(String(16), nullable=True)    # approve|deny|investigate
    confidence = Column(Numeric(3, 2), nullable=True)

    # Agent results (JSONB per SRS 5.1)
    eligibility_result = Column(JSONB, nullable=True)
    coding_result = Column(JSONB, nullable=True)
    fraud_result = Column(JSONB, nullable=True)
    necessity_result = Column(JSONB, nullable=True)

    # Final synthesized decision (used internally; maps 1-to-1 with recommendation)
    adjudication_decision = Column(String(20), nullable=True)
    overall_confidence = Column(Float, nullable=True)
    requires_human_review = Column(Boolean, default=False)
    human_review_reasons = Column(JSONB, default=list)

    # Fraud summary (denormalized for fast dashboard queries)
    fraud_score = Column(Float, nullable=True)
    fraud_risk_level = Column(String(20), nullable=True)

    # SRS 5.1: model_versions JSONB for reproducibility
    model_versions = Column(JSONB, nullable=True)

    # Performance
    processing_time_ms = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("claim_id", "correlation_id", name="uq_claim_correlation"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# ai_agent_memory (SRS 5.2)
# ─────────────────────────────────────────────────────────────────────────────
class AIAgentMemory(Base):
    """
    Persistent pattern storage for cross-claim learning.
    Redis acts as L1 cache; this table is L2 durable store.
    """
    __tablename__ = "ai_agent_memory"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_name = Column(String(64), nullable=False, index=True)
    # SRS 5.2 ENUM(fraud_signal, coding_error, denial_pattern, provider_anomaly)
    pattern_type = Column(String(32), nullable=False, index=True)
    pattern_key = Column(String(256), nullable=False)
    pattern_data = Column(JSONB, nullable=False)       # SRS: pattern_data JSONB
    confidence = Column(Numeric(3, 2), nullable=True)
    occurrence_count = Column(Integer, default=1, nullable=False)
    last_claim_id = Column(String(128), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    expires_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("agent_name", "pattern_key", name="uq_agent_pattern"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# ai_audit_log (SRS 5.3) — APPEND-ONLY, monthly partitioned
# ─────────────────────────────────────────────────────────────────────────────
class AIAuditLog(Base):
    """
    Append-only audit log for FRA compliance.
    Partitioned by month via pg_partman. No UPDATE/DELETE allowed (enforced via RULE).
    Only claim correlation IDs / hashes are stored — no raw PHI (SEC-005).
    """
    __tablename__ = "ai_audit_log"

    # SRS 5.3: log_id BIGSERIAL PK
    log_id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(100), nullable=False, index=True)

    # Correlation only — no PHI (SEC-005)
    claim_correlation_id = Column(String(128), nullable=False, index=True)
    claim_id_hash = Column(String(64), nullable=True)   # SHA-256 truncated

    agent_name = Column(String(100), nullable=True)
    # SRS 5.3: action_detail JSONB
    action_detail = Column(JSONB, nullable=False)

    # Non-PHI context (kept as top-level columns for fast filtering)
    processing_time_ms = Column(Integer, nullable=True)
    model_used = Column(String(128), nullable=True)
    fraud_risk_level = Column(String(20), nullable=True)
    decision = Column(String(20), nullable=True)

    # Immutable timestamp — partition key
    created_at = Column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )


# ─────────────────────────────────────────────────────────────────────────────
# Database engine + session factory
# ─────────────────────────────────────────────────────────────────────────────

_engine = None
_session_factory = None


def create_engine_and_session():
    global _engine, _session_factory
    if _engine is not None and _session_factory is not None:
        return _engine, _session_factory

    settings = get_settings()
    _engine = create_async_engine(
        str(settings.database_url),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        echo=not settings.is_production,
        pool_pre_ping=True,
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine, _session_factory


async def dispose_engine() -> None:
    """Close engine — called from FastAPI lifespan on shutdown."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
