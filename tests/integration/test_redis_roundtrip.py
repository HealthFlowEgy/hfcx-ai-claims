"""
Redis round-trip integration test.

Proves that RedisService + AgentMemoryService talk to a real Redis
instance end-to-end (set/get/publish/scan_iter). This covers the
plumbing that unit tests mock out via AsyncMock.
"""
from __future__ import annotations

import pytest

from src.services.redis_service import (
    AGENT_MEMORY_CHANNEL,
    AgentMemoryService,
    RedisService,
    close_redis_pool,
    get_redis_pool,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _reset_pool(redis_container):
    """Force RedisService to use the env-var pointed-at container."""
    await close_redis_pool()
    # Trigger lazy pool init from the new env var.
    get_redis_pool()
    yield
    await close_redis_pool()


async def test_setex_and_get_roundtrip():
    svc = RedisService()
    ok = await svc.setex("integration:test:1", 60, "hello")
    assert ok
    assert await svc.get("integration:test:1") == "hello"


async def test_publish_is_received_by_subscriber():
    svc = RedisService()
    sub = svc.client.pubsub()
    await sub.subscribe(AGENT_MEMORY_CHANNEL)
    # Drain the subscribe-confirmation message.
    await sub.get_message(timeout=1)

    n = await svc.publish(AGENT_MEMORY_CHANNEL, "ping")
    assert n >= 1

    msg = await sub.get_message(timeout=2)
    assert msg is not None
    assert msg["channel"] == AGENT_MEMORY_CHANNEL
    assert msg["data"] == "ping"
    await sub.unsubscribe(AGENT_MEMORY_CHANNEL)
    await sub.close()


async def test_agent_memory_l1_roundtrip():
    from unittest.mock import AsyncMock, patch

    # Skip the L2 Postgres path — we only exercise L1 Redis here.
    with patch.object(
        AgentMemoryService, "_persist_l2", AsyncMock()
    ):
        svc = AgentMemoryService()
        ok = await svc.store(
            agent_name="fraud",
            pattern_key="integration:test:roundtrip",
            pattern_value={"score": 0.42, "reason": "high_amount"},
        )
        assert ok
        out = await svc.retrieve("fraud", "integration:test:roundtrip")
    assert out == {"score": 0.42, "reason": "high_amount"}


async def test_scan_iter_finds_prefix():
    svc = RedisService()
    for i in range(5):
        await svc.setex(f"integration:scan:{i}", 30, str(i))

    keys = await svc.keys("integration:scan:*")
    assert len(keys) == 5
