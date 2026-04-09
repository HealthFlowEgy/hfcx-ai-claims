"""
Tests for the batched AuditService flusher.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from src.services.audit_service import AuditService


class _FakeSession:
    def __init__(self, batches: list[list[dict]]) -> None:
        self._batches = batches

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *exc) -> None:
        pass

    async def execute(self, _stmt, rows) -> None:
        self._batches.append(list(rows))

    async def commit(self) -> None:
        pass


class _FakeFactory:
    def __init__(self, batches: list[list[dict]]) -> None:
        self._batches = batches

    def __call__(self) -> _FakeSession:
        return _FakeSession(self._batches)


@pytest.mark.asyncio
async def test_batcher_writes_batch_on_interval(monkeypatch):
    batches: list[list[dict]] = []
    factory = _FakeFactory(batches)

    monkeypatch.setattr(
        "src.services.audit_service.create_engine_and_session",
        lambda: (None, factory),
    )
    # Make the flush interval short so the test runs quickly.
    monkeypatch.setattr(
        "src.services.audit_service.settings.audit_flush_interval_seconds",
        0.05,
        raising=False,
    )
    monkeypatch.setattr(
        "src.services.audit_service.settings.audit_batch_size",
        100,
        raising=False,
    )

    await AuditService.start()
    try:
        for i in range(5):
            await AuditService.record(
                event_type="ai.scored",
                correlation_id=f"corr-{i}",
                claim_id=f"claim-{i}",
                action="score",
            )
        # Give the flusher one flush interval to drain the queue.
        await asyncio.sleep(0.15)
    finally:
        await AuditService.stop()

    # All 5 events should have been written in one or more batches.
    total_rows = sum(len(b) for b in batches)
    assert total_rows == 5
    assert all(row["event_type"] == "ai.scored" for batch in batches for row in batch)


@pytest.mark.asyncio
async def test_batcher_drains_on_stop(monkeypatch):
    batches: list[list[dict]] = []
    factory = _FakeFactory(batches)

    monkeypatch.setattr(
        "src.services.audit_service.create_engine_and_session",
        lambda: (None, factory),
    )
    # Long interval — guarantees events sit in the queue until stop().
    monkeypatch.setattr(
        "src.services.audit_service.settings.audit_flush_interval_seconds",
        60.0,
        raising=False,
    )

    await AuditService.start()
    await AuditService.record(
        event_type="ai.recommended",
        correlation_id="corr-stop",
        action="drain",
    )
    await AuditService.stop()

    # Event should have been drained during stop().
    total_rows = sum(len(b) for b in batches)
    assert total_rows == 1


@pytest.mark.asyncio
async def test_queue_full_drops_and_increments_metric(monkeypatch):
    # Tiny queue size forces a drop on the second enqueue.
    monkeypatch.setattr(
        "src.services.audit_service.settings.audit_queue_max_size",
        1,
        raising=False,
    )
    monkeypatch.setattr(
        "src.services.audit_service.settings.audit_flush_interval_seconds",
        60.0,
        raising=False,
    )
    monkeypatch.setattr(
        "src.services.audit_service.create_engine_and_session",
        lambda: (None, _FakeFactory([])),
    )

    # Spy on the dropped-events metric (sync — Counter.inc is not async).
    from unittest.mock import MagicMock
    dropped_inc = MagicMock()
    with patch(
        "src.services.audit_service.AUDIT_EVENTS_DROPPED.inc",
        dropped_inc,
    ):
        await AuditService.start()
        try:
            await AuditService.record(
                event_type="a", correlation_id="c1", action="x"
            )
            await AuditService.record(
                event_type="b", correlation_id="c2", action="y"
            )
        finally:
            await AuditService.stop()

    dropped_inc.assert_called_once()


@pytest.mark.asyncio
async def test_record_fallback_writes_synchronously(monkeypatch):
    """When start() was never called, record() falls back to a direct write."""
    batches: list[list[dict]] = []
    factory = _FakeFactory(batches)
    monkeypatch.setattr(
        "src.services.audit_service.create_engine_and_session",
        lambda: (None, factory),
    )
    # Ensure no flusher is running.
    await AuditService.stop()

    await AuditService.record(
        event_type="ai.failed",
        correlation_id="corr-sync",
        action="sync",
    )
    total_rows = sum(len(b) for b in batches)
    assert total_rows == 1


def test_hash_claim_id_is_deterministic_and_short():
    h1 = AuditService._hash_claim_id("CLAIM-X")
    h2 = AuditService._hash_claim_id("CLAIM-X")
    h3 = AuditService._hash_claim_id("CLAIM-Y")
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 16
    assert AuditService._hash_claim_id(None) is None
