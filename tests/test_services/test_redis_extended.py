"""
ISSUE-064: Extended Redis service tests — covers lpush, lrange, expire methods.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_lpush_success():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(svc._client, "lpush", new_callable=AsyncMock, return_value=1):
        result = await svc.lpush("test:list", "value1")
    assert result == 1


@pytest.mark.asyncio
async def test_lpush_failure_returns_zero():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(
        svc._client, "lpush", new_callable=AsyncMock, side_effect=ConnectionError("fail")
    ):
        result = await svc.lpush("test:list", "value1")
    assert result == 0


@pytest.mark.asyncio
async def test_lrange_success():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(
        svc._client, "lrange", new_callable=AsyncMock, return_value=["a", "b", "c"]
    ):
        result = await svc.lrange("test:list", 0, -1)
    assert result == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_lrange_failure_returns_empty():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(
        svc._client, "lrange", new_callable=AsyncMock, side_effect=ConnectionError("fail")
    ):
        result = await svc.lrange("test:list", 0, -1)
    assert result == []


@pytest.mark.asyncio
async def test_expire_success():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(svc._client, "expire", new_callable=AsyncMock, return_value=True):
        result = await svc.expire("test:key", 3600)
    assert result is True


@pytest.mark.asyncio
async def test_expire_failure_returns_false():
    from src.services.redis_service import RedisService

    svc = RedisService()
    with patch.object(
        svc._client, "expire", new_callable=AsyncMock, side_effect=ConnectionError("fail")
    ):
        result = await svc.expire("test:key", 3600)
    assert result is False
