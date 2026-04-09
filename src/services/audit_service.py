"""
Audit Service (SEC-003) — append-only writer to ai_audit_log.

Called by the coordinator, Kafka consumer, and memory service to record
PHI-free audit events for FRA compliance.
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import insert

from src.models.orm import AIAuditLog, create_engine_and_session

log = structlog.get_logger(__name__)


class AuditService:
    """All methods are classmethods — this is a thin sink."""

    @staticmethod
    def _hash_claim_id(claim_id: str | None) -> str | None:
        if not claim_id:
            return None
        return hashlib.sha256(claim_id.encode()).hexdigest()[:16]

    @classmethod
    async def record(
        cls,
        *,
        event_type: str,
        correlation_id: str | None,
        claim_id: str | None = None,
        agent_name: str | None = None,
        action: str | None = None,
        outcome: str | None = None,
        decision: str | None = None,
        fraud_risk_level: str | None = None,
        processing_time_ms: int | None = None,
        model_used: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        """
        Append a single audit event. Never raises — audit failures are logged
        and swallowed so they cannot block a claim decision.
        """
        try:
            _, session_factory = create_engine_and_session()
        except Exception as exc:  # pragma: no cover — engine unavailable in some dev paths
            log.warning("audit_engine_unavailable", error=str(exc))
            return

        action_detail: dict[str, Any] = {
            "action": action or event_type,
            "outcome": outcome,
            **(detail or {}),
        }

        payload = {
            "event_type": event_type,
            "claim_correlation_id": correlation_id or "unknown",
            "claim_id_hash": cls._hash_claim_id(claim_id),
            "agent_name": agent_name,
            "action_detail": action_detail,
            "processing_time_ms": processing_time_ms,
            "model_used": model_used,
            "fraud_risk_level": fraud_risk_level,
            "decision": decision,
            "created_at": datetime.now(UTC),
        }

        try:
            async with session_factory() as session:
                await session.execute(insert(AIAuditLog).values(**payload))
                await session.commit()
        except Exception as exc:
            # SEC-003: never let audit failure propagate to claim processing.
            log.warning("audit_write_failed", error=str(exc), event_type=event_type)
