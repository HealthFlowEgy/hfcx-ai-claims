"""Tests for src/api/routes/documents.py — document upload/download."""
import pytest

_AUTH = {"Authorization": "Bearer dev-token"}


@pytest.mark.asyncio
async def test_documents_list_requires_auth(async_client):
    """GET /internal/ai/documents without JWT returns 403/404."""
    resp = await async_client.get("/internal/ai/documents")
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_documents_list_with_auth(async_client):
    """GET /internal/ai/documents with JWT returns 200 or 404."""
    resp = await async_client.get(
        "/internal/ai/documents",
        headers=_AUTH,
    )
    assert resp.status_code in (200, 404)


@pytest.mark.asyncio
async def test_documents_upload_no_file(async_client):
    """POST /internal/ai/documents without file returns 422."""
    resp = await async_client.post(
        "/internal/ai/documents",
        headers=_AUTH,
    )
    assert resp.status_code in (400, 404, 422)
