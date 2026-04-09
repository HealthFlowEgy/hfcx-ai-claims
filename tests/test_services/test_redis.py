"""
Unit tests for the plumbing in RedisService (no live Redis).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import redis.exceptions as redis_exc

from src.services.redis_service import RedisService


@pytest.mark.asyncio
@patch("src.services.redis_service.redis.Redis")
async def test_get_returns_none_on_error(mock_redis_cls):
    client = AsyncMock()
    client.get = AsyncMock(side_effect=redis_exc.ConnectionError("down"))
    mock_redis_cls.return_value = client

    svc = RedisService()
    svc._client = client
    assert await svc.get("k") is None


@pytest.mark.asyncio
@patch("src.services.redis_service.redis.Redis")
async def test_setex_returns_false_on_error(mock_redis_cls):
    client = AsyncMock()
    client.setex = AsyncMock(side_effect=redis_exc.ConnectionError("down"))
    mock_redis_cls.return_value = client

    svc = RedisService()
    svc._client = client
    assert await svc.setex("k", 10, "v") is False


@pytest.mark.asyncio
@patch("src.services.redis_service.redis.Redis")
async def test_delete_returns_zero_on_error(mock_redis_cls):
    client = AsyncMock()
    client.delete = AsyncMock(side_effect=redis_exc.ConnectionError("down"))
    mock_redis_cls.return_value = client

    svc = RedisService()
    svc._client = client
    assert await svc.delete("k") == 0


@pytest.mark.asyncio
@patch("src.services.redis_service.redis.Redis")
async def test_publish_returns_zero_on_error(mock_redis_cls):
    client = AsyncMock()
    client.publish = AsyncMock(side_effect=redis_exc.ConnectionError("down"))
    mock_redis_cls.return_value = client

    svc = RedisService()
    svc._client = client
    assert await svc.publish("c", "m") == 0


@pytest.mark.asyncio
@patch("src.services.redis_service.redis.Redis")
async def test_ping_returns_false_on_error(mock_redis_cls):
    client = AsyncMock()
    client.ping = AsyncMock(side_effect=redis_exc.ConnectionError("down"))
    mock_redis_cls.return_value = client

    svc = RedisService()
    svc._client = client
    assert await svc.ping() is False
