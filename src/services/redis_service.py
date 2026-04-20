"""
Redis Service — async Redis client with connection pooling.

Used for: eligibility cache, agent state checkpointing, fraud provider scores,
          duplicate claim detection, shared memory L1, and pub/sub pattern
          propagation across agents (FR-SM-002).
"""
from __future__ import annotations

import json
from collections.abc import Awaitable
from datetime import UTC, datetime
from typing import Any, TypeVar, cast

import redis.asyncio as redis
import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.config import get_settings
from src.models.orm import AIAgentMemory, create_engine_and_session
from src.models.schemas import MemoryPatternType
from src.utils.metrics import MEMORY_STORE_OPS

log = structlog.get_logger(__name__)
settings = get_settings()

_T = TypeVar("_T")


def _await_redis(value: Any) -> Awaitable[Any]:
    """
    ``redis.asyncio.Redis`` method return types are overloaded with a sync
    branch via `ResponseT = Union[Awaitable[T], T]`, which confuses mypy
    in pure-async contexts. This thin cast hides the union and lets the
    rest of the module use straight ``await`` without per-call noqa.
    """
    return cast(Awaitable[Any], value)

_redis_pool: redis.ConnectionPool | None = None

AGENT_MEMORY_CHANNEL = "hfcx:agent_memory:updates"


def get_redis_pool() -> redis.ConnectionPool:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool.from_url(
            str(settings.redis_url),
            max_connections=50,
            decode_responses=True,
        )
    return _redis_pool


async def close_redis_pool() -> None:
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.disconnect()
        _redis_pool = None


class RedisService:
    """Async Redis client. Instantiated per-request or per-agent call."""

    def __init__(self) -> None:
        self._client = redis.Redis(connection_pool=get_redis_pool())

    @property
    def client(self) -> redis.Redis:
        return self._client

    async def get(self, key: str) -> str | None:
        try:
            val = await self._client.get(key)
            return str(val) if val is not None else None
        except Exception as exc:
            log.warning("redis_get_failed", key=key, error=str(exc))
            return None

    async def set(self, key: str, value: str) -> bool:
        try:
            return bool(await self._client.set(key, value))
        except Exception as exc:
            log.warning("redis_set_failed", key=key, error=str(exc))
            return False

    async def setex(self, key: str, ttl_seconds: int, value: str) -> bool:
        try:
            return bool(await self._client.setex(key, ttl_seconds, value))
        except Exception as exc:
            log.warning("redis_setex_failed", key=key, error=str(exc))
            return False

    async def delete(self, key: str) -> int:
        try:
            return int(await self._client.delete(key))
        except Exception as exc:
            log.warning("redis_delete_failed", key=key, error=str(exc))
            return 0

    async def keys(self, pattern: str) -> list[str]:
        """SCAN-based wildcard lookup (avoids KEYS blocking the server)."""
        try:
            found: list[str] = []
            async for key in self._client.scan_iter(match=pattern, count=100):
                found.append(str(key))
            return found
        except Exception as exc:
            log.warning("redis_keys_failed", pattern=pattern, error=str(exc))
            return []

    async def exists(self, key: str) -> bool:
        try:
            return bool(await self._client.exists(key))
        except Exception as exc:
            log.warning("redis_exists_failed", key=key, error=str(exc))
            return False

    async def publish(self, channel: str, message: str) -> int:
        try:
            return int(await self._client.publish(channel, message))
        except Exception as exc:
            log.warning("redis_publish_failed", channel=channel, error=str(exc))
            return 0

    async def ping(self) -> bool:
        try:
            return bool(await _await_redis(self._client.ping()))
        except Exception:
            return False

    async def lpush(self, key: str, value: str) -> int:
        """Push a value to the head of a Redis list."""
        try:
            return int(await self._client.lpush(key, value))
        except Exception as exc:
            log.warning("redis_lpush_failed", key=key, error=str(exc))
            return 0

    async def lrange(self, key: str, start: int, stop: int) -> list[str]:
        """Return a range of elements from a Redis list."""
        try:
            result = await self._client.lrange(key, start, stop)
            return [str(v) for v in result] if result else []
        except Exception as exc:
            log.warning("redis_lrange_failed", key=key, error=str(exc))
            return []

    async def expire(self, key: str, ttl_seconds: int) -> bool:
        """Set a TTL on a Redis key."""
        try:
            return bool(await self._client.expire(key, ttl_seconds))
        except Exception as exc:
            log.warning("redis_expire_failed", key=key, error=str(exc))
            return False

    async def close(self) -> None:
        await self._client.close()


# ─────────────────────────────────────────────────────────────────────────────
# Agent Memory Service (SRS 4.6 — Shared Memory & Pattern Learning)
# ─────────────────────────────────────────────────────────────────────────────

class AgentMemoryService:
    """
    FR-SM-001: Two-tier storage
        L1 Redis  — hot cache, fast read/write, configurable TTL
        L2 Postgres — durable ai_agent_memory table

    FR-SM-002: Every write publishes to the AGENT_MEMORY_CHANNEL pub/sub
    channel so other agents can propagate patterns within 1 second.
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
        pattern_type: MemoryPatternType = MemoryPatternType.FRAUD_SIGNAL,
        confidence: float | None = None,
        claim_id: str | None = None,
        ttl_seconds: int | None = None,
    ) -> bool:
        """
        Write to Redis (L1) + Postgres (L2) + publish to pub/sub.
        L2 failure does not abort the L1 write.
        """
        key = self._key(agent_name, pattern_key)
        ttl = ttl_seconds or settings.redis_agent_state_ttl_seconds

        # L1: Redis
        envelope = {
            "value": pattern_value,
            "pattern_type": pattern_type.value,
            "confidence": confidence,
            "claim_id": claim_id,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        l1_ok = await self._redis.setex(key, ttl, json.dumps(envelope))
        MEMORY_STORE_OPS.labels(tier="l1", outcome="ok" if l1_ok else "error").inc()

        # FR-SM-002: pub/sub propagation (<1s)
        try:
            await self._redis.publish(
                AGENT_MEMORY_CHANNEL,
                json.dumps(
                    {
                        "agent_name": agent_name,
                        "pattern_key": pattern_key,
                        "pattern_type": pattern_type.value,
                    }
                ),
            )
        except Exception as exc:  # pragma: no cover
            log.warning("memory_publish_failed", error=str(exc))

        # L2: Postgres durable store
        await self._persist_l2(
            agent_name=agent_name,
            pattern_type=pattern_type,
            pattern_key=pattern_key,
            pattern_value=pattern_value,
            confidence=confidence,
            claim_id=claim_id,
        )

        return l1_ok

    async def _persist_l2(
        self,
        *,
        agent_name: str,
        pattern_type: MemoryPatternType,
        pattern_key: str,
        pattern_value: dict[str, Any],
        confidence: float | None,
        claim_id: str | None,
    ) -> None:
        try:
            _, session_factory = create_engine_and_session()
        except Exception as exc:  # pragma: no cover
            log.warning("memory_l2_engine_unavailable", error=str(exc))
            MEMORY_STORE_OPS.labels(tier="l2", outcome="error").inc()
            return

        try:
            async with session_factory() as session:
                stmt = pg_insert(AIAgentMemory).values(
                    agent_name=agent_name,
                    pattern_type=pattern_type.value,
                    pattern_key=pattern_key,
                    pattern_data=pattern_value,
                    confidence=confidence,
                    occurrence_count=1,
                    last_claim_id=claim_id,
                )
                # Upsert: increment occurrence_count on conflict
                stmt = stmt.on_conflict_do_update(
                    index_elements=["agent_name", "pattern_key"],
                    set_={
                        "pattern_data": pattern_value,
                        "confidence": confidence,
                        "last_claim_id": claim_id,
                        "occurrence_count": AIAgentMemory.occurrence_count + 1,
                    },
                )
                await session.execute(stmt)
                await session.commit()
                MEMORY_STORE_OPS.labels(tier="l2", outcome="ok").inc()
        except Exception as exc:
            log.warning("memory_l2_write_failed", error=str(exc))
            MEMORY_STORE_OPS.labels(tier="l2", outcome="error").inc()

    async def retrieve(
        self, agent_name: str, pattern_key: str
    ) -> dict[str, Any] | None:
        """Retrieve pattern from Redis L1 first, fall back to Postgres L2."""
        key = self._key(agent_name, pattern_key)
        raw = await self._redis.get(key)
        if raw:
            try:
                data = json.loads(raw)
                return data.get("value") if isinstance(data, dict) and "value" in data else data
            except json.JSONDecodeError:
                return None

        # L2 fallback
        try:
            _, session_factory = create_engine_and_session()
            async with session_factory() as session:
                row = (
                    await session.execute(
                        select(AIAgentMemory).where(
                            AIAgentMemory.agent_name == agent_name,
                            AIAgentMemory.pattern_key == pattern_key,
                        )
                    )
                ).scalar_one_or_none()
                return dict(row.pattern_data) if row and row.pattern_data else None
        except Exception as exc:  # pragma: no cover
            log.warning("memory_l2_read_failed", error=str(exc))
            return None

    async def retrieve_agent_context(
        self, agent_name: str, limit: int = 50
    ) -> list[dict[str, Any]]:
        """
        Retrieve all stored patterns for an agent (for the
        GET /internal/ai/memory/context/{agent} endpoint).

        Reads L2 (Postgres) as source of truth for the full history.
        """
        try:
            _, session_factory = create_engine_and_session()
            async with session_factory() as session:
                rows = (
                    (
                        await session.execute(
                            select(AIAgentMemory)
                            .where(AIAgentMemory.agent_name == agent_name)
                            .order_by(AIAgentMemory.updated_at.desc())
                            .limit(limit)
                        )
                    )
                    .scalars()
                    .all()
                )
                return [
                    {
                        "pattern_key": r.pattern_key,
                        "pattern_type": r.pattern_type,
                        "value": r.pattern_data,
                        "confidence": float(r.confidence) if r.confidence is not None else None,
                        "occurrence_count": r.occurrence_count,
                        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    }
                    for r in rows
                ]
        except Exception as exc:  # pragma: no cover
            log.warning("memory_l2_context_failed", error=str(exc))
            # Fallback: scan Redis
            pattern = f"{self.MEMORY_PREFIX}{agent_name}:*"
            keys = await self._redis.keys(pattern)
            results: list[dict[str, Any]] = []
            for key in keys[:limit]:
                raw = await self._redis.get(key)
                if raw:
                    try:
                        env = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    results.append(
                        {
                            "pattern_key": key.replace(
                                f"{self.MEMORY_PREFIX}{agent_name}:", ""
                            ),
                            "value": env.get("value") if isinstance(env, dict) else env,
                        }
                    )
            return results
