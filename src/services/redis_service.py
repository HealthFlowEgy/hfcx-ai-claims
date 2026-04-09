"""
Redis Service — async Redis client with connection pooling.
Used for: eligibility cache, agent state checkpointing, fraud provider scores,
          duplicate claim detection, and agent memory L1 cache.
"""
from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()

_redis_pool: redis.ConnectionPool | None = None


def get_redis_pool() -> redis.ConnectionPool:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool.from_url(
            str(settings.redis_url),
            max_connections=50,
            decode_responses=True,
        )
    return _redis_pool


class RedisService:
    """Async Redis client. Instantiated per-request or per-agent call."""

    def __init__(self) -> None:
        self._client = redis.Redis(connection_pool=get_redis_pool())

    async def get(self, key: str) -> str | None:
        try:
            return await self._client.get(key)
        except Exception as exc:
            log.warning("redis_get_failed", key=key, error=str(exc))
            return None

    async def set(self, key: str, value: str) -> bool:
        try:
            return await self._client.set(key, value)
        except Exception as exc:
            log.warning("redis_set_failed", key=key, error=str(exc))
            return False

    async def setex(self, key: str, ttl_seconds: int, value: str) -> bool:
        try:
            return await self._client.setex(key, ttl_seconds, value)
        except Exception as exc:
            log.warning("redis_setex_failed", key=key, error=str(exc))
            return False

    async def delete(self, key: str) -> int:
        try:
            return await self._client.delete(key)
        except Exception as exc:
            log.warning("redis_delete_failed", key=key, error=str(exc))
            return 0

    async def keys(self, pattern: str) -> list[str]:
        try:
            return await self._client.keys(pattern)
        except Exception as exc:
            log.warning("redis_keys_failed", pattern=pattern, error=str(exc))
            return []

    async def exists(self, key: str) -> bool:
        try:
            return bool(await self._client.exists(key))
        except Exception as exc:
            log.warning("redis_exists_failed", key=key, error=str(exc))
            return False

    async def ping(self) -> bool:
        try:
            return await self._client.ping()
        except Exception:
            return False

    async def close(self) -> None:
        await self._client.aclose()


# ─────────────────────────────────────────────────────────────────────────────
# Agent Memory Service (SRS 4.6 — Shared Memory & Pattern Learning)
# ─────────────────────────────────────────────────────────────────────────────

class AgentMemoryService:
    """
    FR-SM-001 through FR-SM-003 implementation.

    Two-tier storage:
    - L1: Redis (fast read/write, configurable TTL)
    - L2: PostgreSQL ai_agent_memory table (durable, queryable)

    Used by all agents to share patterns across claims:
    - Eligibility: cached coverage rules per payer
    - Coding: common miscodings per provider specialty
    - Fraud: provider risk profiles, patient patterns
    - Necessity: approved/denied procedure patterns per diagnosis
    """

    MEMORY_PREFIX = "agent_memory:v1:"

    def __init__(self) -> None:
        self._redis = RedisService()

    def _key(self, agent_name: str, pattern_key: str) -> str:
        return f"{self.MEMORY_PREFIX}{agent_name}:{pattern_key}"

    async def store(
        self,
        agent_name: str,
        pattern_key: str,
        pattern_value: dict[str, Any],
        ttl_seconds: int | None = None,
    ) -> bool:
        """Store pattern in Redis (L1). PostgreSQL persistence handled by background job."""
        key = self._key(agent_name, pattern_key)
        ttl = ttl_seconds or settings.redis_agent_state_ttl_seconds
        return await self._redis.setex(key, ttl, json.dumps(pattern_value))

    async def retrieve(self, agent_name: str, pattern_key: str) -> dict[str, Any] | None:
        """Retrieve pattern from Redis."""
        key = self._key(agent_name, pattern_key)
        raw = await self._redis.get(key)
        if raw:
            return json.loads(raw)
        return None

    async def retrieve_agent_context(self, agent_name: str) -> list[dict[str, Any]]:
        """
        Retrieve all stored patterns for an agent (for GET /internal/ai/memory/context/{agent}).
        In production: queries PostgreSQL ai_agent_memory table for full history.
        """
        pattern = f"{self.MEMORY_PREFIX}{agent_name}:*"
        keys = await self._redis.keys(pattern)
        results = []
        for key in keys[:50]:  # Cap at 50 to avoid flooding response
            raw = await self._redis.get(key)
            if raw:
                results.append({
                    "pattern_key": key.replace(f"{self.MEMORY_PREFIX}{agent_name}:", ""),
                    "value": json.loads(raw),
                })
        return results
