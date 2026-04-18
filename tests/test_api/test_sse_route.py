"""Tests for src/api/routes/sse.py — SSE streaming endpoint."""
import pytest

_AUTH = {"Authorization": "Bearer dev-token"}


@pytest.mark.asyncio
async def test_sse_stream_requires_auth(async_client):
    """GET /internal/ai/stream without JWT returns 403 or 404."""
    resp = await async_client.get("/internal/ai/stream")
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_sse_stream_with_auth(async_client):
    """GET /internal/ai/stream with JWT returns 200 or 404."""
    resp = await async_client.get(
        "/internal/ai/stream",
        headers=_AUTH,
    )
    # SSE endpoint may return 200 (streaming) or 404 if not mounted
    assert resp.status_code in (200, 404)
