"""
Unit tests for the EligibilityAgent — cache key shape and cache hit path.
"""
from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.agents.eligibility import EligibilityAgent
from src.models.schemas import AgentStatus, ClaimType, EligibilityResult


def _eligibility_fixture_redis():
    mock = AsyncMock()
    mock.get.return_value = None
    mock.setex.return_value = True
    mock.delete.return_value = 1
    raw = AsyncMock()
    raw.sadd = AsyncMock(return_value=1)
    raw.expire = AsyncMock(return_value=True)
    raw.smembers = AsyncMock(return_value=set())
    mock.client = raw
    return mock


def test_cache_key_is_deterministic_and_month_bucketed():
    agent = EligibilityAgent()
    k1 = agent._cache_key(
        "29901011234567",
        "MISR-001",
        datetime(2026, 4, 1),
        ClaimType.OUTPATIENT,
    )
    k2 = agent._cache_key(
        "29901011234567",
        "MISR-001",
        datetime(2026, 4, 15),   # same month
        ClaimType.OUTPATIENT,
    )
    k3 = agent._cache_key(
        "29901011234567",
        "MISR-001",
        datetime(2026, 5, 1),    # different month
        ClaimType.OUTPATIENT,
    )
    assert k1 == k2
    assert k1 != k3
    assert k1.startswith("eligibility:v1:")


@pytest.mark.asyncio
@patch("src.agents.eligibility.RedisService")
async def test_verify_returns_cached(mock_redis_cls, sample_claim):
    mock_redis = _eligibility_fixture_redis()
    cached_payload = EligibilityResult(
        status=AgentStatus.COMPLETED,
        is_eligible=True,
        coverage_active=True,
    ).model_dump_json()
    mock_redis.get.return_value = cached_payload
    mock_redis_cls.return_value = mock_redis

    agent = EligibilityAgent()
    result = await agent.verify(sample_claim)
    assert result.is_eligible is True
    assert result.cache_hit is True


@pytest.mark.asyncio
@patch("src.agents.eligibility.RedisService")
async def test_invalidate_cache_uses_index(mock_redis_cls):
    mock_redis = _eligibility_fixture_redis()
    mock_redis.client.smembers = AsyncMock(
        return_value={"eligibility:v1:abcd1234deadbeef"}
    )
    mock_redis_cls.return_value = mock_redis

    agent = EligibilityAgent()
    count = await agent.invalidate_cache("29901011234567", "MISR-001")
    assert count == 1


@pytest.mark.asyncio
@patch("src.agents.eligibility.RedisService")
async def test_verify_fetches_registry_on_cache_miss(mock_redis_cls, sample_claim):
    from unittest.mock import MagicMock

    mock_redis = _eligibility_fixture_redis()
    mock_redis.get.return_value = None    # force cache miss
    mock_redis_cls.return_value = mock_redis

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock(return_value=None)
    mock_response.json = MagicMock(
        return_value={
            "eligible": True,
            "coverage_active": True,
            "coverage_type": "family",
            "deductible_remaining": 100.0,
            "copay_percentage": 20.0,
            "exclusions": ["cosmetic"],
        }
    )

    async def _post(*a, **kw):
        return mock_response

    agent = EligibilityAgent()
    agent._http = MagicMock()
    agent._http.post = _post  # type: ignore[assignment]

    result = await agent.verify(sample_claim)
    assert result.is_eligible is True
    assert result.coverage_type == "family"
    assert result.cache_hit is False
    mock_redis.setex.assert_awaited()
