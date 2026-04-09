"""
SQLAlchemy ORM — ai_claim_analysis, ai_agent_memory, ai_audit_log
Matches SRS Section 5 data model exactly.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, JSON, String, Text,
    UniqueConstraint, event, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncAttrs, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from src.config import get_settings


class Base(AsyncAttrs, DeclarativeBase):
    pass


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

    # Agent results (denormalized JSON for fast read path)
    eligibility_result = Column(JSON, nullable=True)
    coding_result = Column(JSON, nullable=True)
    fraud_result = Column(JSON, nullable=True)
    necessity_result = Column(JSON, nullable=True)

    # Final decision
    adjudication_decision = Column(String(20), nullable=True)   # approved|denied|pended|partial
    overall_confidence = Column(Float, nullable=True)
    requires_human_review = Column(Boolean, default=False)
    human_review_reasons = Column(JSON, default=list)

    # Fraud summary (denormalized for fast dashboard queries)
    fraud_score = Column(Float, nullable=True)
    fraud_risk_level = Column(String(20), nullable=True)

    # Performance
    processing_time_ms = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

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
    pattern_key = Column(String(256), nullable=False)           # e.g. "provider:P001:billing_pattern"
    pattern_value = Column(JSON, nullable=False)
    confidence = Column(Float, nullable=True)
    occurrence_count = Column(Integer, default=1)
    last_seen_claim_id = Column(String(128), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("agent_name", "pattern_key", name="uq_agent_pattern"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# ai_audit_log (SRS 5.3) — APPEND-ONLY, monthly partitioned
# ─────────────────────────────────────────────────────────────────────────────
class AIAuditLog(Base):
    """
    Append-only audit log for FRA compliance.
    Partitioned by month via pg_partman. No UPDATE/DELETE allowed (enforced by trigger).
    Only claim correlation IDs are stored — no raw PHI.
    """
    __tablename__ = "ai_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type = Column(String(64), nullable=False, index=True)

    # Correlation only — no PHI (SEC-005)
    correlation_id = Column(String(128), nullable=False, index=True)
    hcx_correlation_id = Column(String(128), nullable=True)
    claim_id_hash = Column(String(64), nullable=True)           # SHA-256 of claim_id — not reversible

    # What happened
    agent_name = Column(String(64), nullable=True)
    action = Column(String(128), nullable=False)
    outcome = Column(String(64), nullable=True)
    decision = Column(String(20), nullable=True)

    # Non-PHI context
    processing_time_ms = Column(Integer, nullable=True)
    model_used = Column(String(128), nullable=True)
    fraud_risk_level = Column(String(20), nullable=True)

    # Immutable timestamp
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


# ─────────────────────────────────────────────────────────────────────────────
# Database engine + session factory
# ─────────────────────────────────────────────────────────────────────────────

def create_engine_and_session():
    settings = get_settings()
    engine = create_async_engine(
        str(settings.database_url),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        echo=not settings.is_production,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, session_factory
