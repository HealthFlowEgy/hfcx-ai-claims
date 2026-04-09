"""
Tests for AgentMemoryService (FR-SM-001/002) and AuditService (SEC-003).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.schemas import MemoryPatternType
from src.services.audit_service import AuditService
from src.services.redis_service import AgentMemoryService


@pytest.mark.asyncio
@patch("src.services.redis_service.RedisService")
@patch("src.services.redis_service.AgentMemoryService._persist_l2", AsyncMock())
async def test_memory_store_publishes_to_channel(mock_redis_cls):
    mock_redis = AsyncMock()
    mock_redis.setex.return_value = True
    mock_redis.publish.return_value = 1
    mock_redis_cls.return_value = mock_redis

    svc = AgentMemoryService()
    ok = await svc.store(
        agent_name="fraud",
        pattern_key="provider:P1:billing",
        pattern_value={"flag": "upcoding"},
        pattern_type=MemoryPatternType.FRAUD_SIGNAL,
        confidence=0.8,
        claim_id="CLAIM-1",
    )
    assert ok is True
    mock_redis.setex.assert_awaited()
    mock_redis.publish.assert_awaited()


@pytest.mark.asyncio
@patch("src.services.redis_service.RedisService")
@patch("src.services.redis_service.AgentMemoryService._persist_l2", AsyncMock())
async def test_memory_retrieve_from_redis(mock_redis_cls):
    import json

    mock_redis = AsyncMock()
    mock_redis.get.return_value = json.dumps(
        {"value": {"flag": "upcoding"}, "pattern_type": "fraud_signal"}
    )
    mock_redis_cls.return_value = mock_redis

    svc = AgentMemoryService()
    out = await svc.retrieve("fraud", "provider:P1:billing")
    assert out == {"flag": "upcoding"}


def test_audit_claim_id_hash():
    h = AuditService._hash_claim_id("CLAIM-001")
    assert h is not None
    assert len(h) == 16
    assert AuditService._hash_claim_id(None) is None
    assert AuditService._hash_claim_id("CLAIM-001") == AuditService._hash_claim_id(
        "CLAIM-001"
    )


@pytest.mark.asyncio
async def test_audit_record_swallows_errors_on_no_engine():
    with patch(
        "src.services.audit_service.create_engine_and_session",
        side_effect=RuntimeError("no engine"),
    ):
        # Must not raise
        await AuditService.record(
            event_type="ai.scored",
            correlation_id="corr-1",
            claim_id="CLAIM-1",
            action="test",
        )
