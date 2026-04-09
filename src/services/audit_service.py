"""
Audit Service (SEC-003) — append-only writer to ai_audit_log.

Called by the coordinator, Kafka consumer, and memory service to record
PHI-free audit events for FRA compliance.

Batching
────────
Each claim produces 1-3 audit events. At NFR-001 throughput targets
(50+ claims/min/pod, 10 pods = 500+ events/min sustained, burst into
thousands/min) doing a synchronous INSERT + COMMIT per event would
dominate the claim latency budget. We therefore:

1. `AuditService.record(...)` enqueues onto a bounded asyncio.Queue
   and returns immediately. Back-pressure: if the queue is full we
   drop the event, bump a Prometheus counter, and log a warning so
   on-call still sees the pressure even though claim processing is
   not blocked.
2. A single background flusher task drains up to `audit_batch_size`
   rows in one INSERT every `audit_flush_interval_seconds`, giving
   the database a batch of 100 rows per transaction instead of 1.
3. Graceful shutdown (`AuditService.stop`) flushes the remaining
   queue contents before the event loop closes.

The public method signature is unchanged — existing call sites keep
working. In dev / tests where the flusher is not started we still
fall back to a direct write via the synchronous path so SEC-003
behavior is identical.
"""
from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import insert

from src.config import get_settings
from src.models.orm import AIAuditLog, create_engine_and_session
from src.utils.metrics import AUDIT_EVENTS_DROPPED, AUDIT_EVENTS_FLUSHED, AUDIT_QUEUE_DEPTH

log = structlog.get_logger(__name__)
settings = get_settings()


class AuditService:
    """
    Batched append-only audit log writer.

    Usage:
        await AuditService.start()         # from FastAPI lifespan
        await AuditService.record(...)     # from any agent/consumer
        await AuditService.stop()          # from FastAPI lifespan
    """

    _queue: asyncio.Queue[dict[str, Any]] | None = None
    _flusher: asyncio.Task | None = None
    _stopping: asyncio.Event | None = None

    # ── lifecycle ─────────────────────────────────────────────────────────
    @classmethod
    async def start(cls) -> None:
        """Start the background flusher. Idempotent."""
        if cls._flusher is not None and not cls._flusher.done():
            return
        cls._queue = asyncio.Queue(maxsize=settings.audit_queue_max_size)
        cls._stopping = asyncio.Event()
        cls._flusher = asyncio.create_task(cls._flusher_loop(), name="audit_flusher")
        log.info(
            "audit_flusher_started",
            batch_size=settings.audit_batch_size,
            interval=settings.audit_flush_interval_seconds,
            max_queue=settings.audit_queue_max_size,
        )

    @classmethod
    async def stop(cls) -> None:
        """Stop the flusher, draining any pending events first."""
        if cls._flusher is None:
            return
        if cls._stopping is not None:
            cls._stopping.set()
        # Cancel the idle wait inside _collect_batch so we don't sit at the
        # queue.get() timeout waiting for the next wakeup.
        cls._flusher.cancel()
        try:
            await cls._flusher
        except (asyncio.CancelledError, Exception):
            pass
        # Final drain in case the flusher loop exited before emptying the queue.
        await cls._drain_remaining()
        cls._flusher = None
        cls._queue = None
        cls._stopping = None
        log.info("audit_flusher_stopped")

    # ── producer API ──────────────────────────────────────────────────────
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
        Enqueue an audit event. Never raises — a full queue or a DB
        failure is logged + metric'd but never propagates to the caller.
        """
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

        # Fast path: enqueue for the flusher
        if cls._queue is not None:
            try:
                cls._queue.put_nowait(payload)
                AUDIT_QUEUE_DEPTH.set(cls._queue.qsize())
                return
            except asyncio.QueueFull:
                AUDIT_EVENTS_DROPPED.inc()
                log.warning(
                    "audit_queue_full_event_dropped",
                    event_type=event_type,
                    correlation_id=correlation_id,
                )
                return

        # Fallback: flusher not running (dev/tests). Write synchronously.
        await cls._write_batch([payload])

    # ── flusher internals ────────────────────────────────────────────────
    @classmethod
    async def _flusher_loop(cls) -> None:
        assert cls._queue is not None
        assert cls._stopping is not None

        while not cls._stopping.is_set():
            batch = await cls._collect_batch()
            if batch:
                await cls._write_batch(batch)
                AUDIT_EVENTS_FLUSHED.inc(len(batch))
                if cls._queue is not None:
                    AUDIT_QUEUE_DEPTH.set(cls._queue.qsize())
        # Final drain — stop was signalled.
        await cls._drain_remaining()

    @classmethod
    async def _collect_batch(cls) -> list[dict[str, Any]]:
        """
        Block until either `audit_batch_size` rows are available or
        `audit_flush_interval_seconds` have elapsed since the first row.
        """
        assert cls._queue is not None
        assert cls._stopping is not None

        batch: list[dict[str, Any]] = []
        try:
            first = await asyncio.wait_for(
                cls._queue.get(),
                timeout=settings.audit_flush_interval_seconds,
            )
            batch.append(first)
        except TimeoutError:
            return batch

        # Pull any additional rows that are already queued, up to batch_size.
        while len(batch) < settings.audit_batch_size:
            try:
                batch.append(cls._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return batch

    @classmethod
    async def _drain_remaining(cls) -> None:
        """Flush any rows still in the queue at shutdown time."""
        if cls._queue is None:
            return
        pending: list[dict[str, Any]] = []
        while True:
            try:
                pending.append(cls._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        if pending:
            await cls._write_batch(pending)
            AUDIT_EVENTS_FLUSHED.inc(len(pending))

    @classmethod
    async def _write_batch(cls, rows: list[dict[str, Any]]) -> None:
        """Persist a batch of audit rows. Never raises."""
        if not rows:
            return
        try:
            _, session_factory = create_engine_and_session()
        except Exception as exc:  # pragma: no cover
            log.warning("audit_engine_unavailable", error=str(exc))
            return

        try:
            async with session_factory() as session:
                await session.execute(insert(AIAuditLog), rows)
                await session.commit()
        except Exception as exc:
            # SEC-003: audit failure must not break claim processing.
            log.warning(
                "audit_write_failed",
                error=str(exc),
                count=len(rows),
            )
