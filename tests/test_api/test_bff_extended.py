"""
ISSUE-064: Extended BFF route tests — covers response shapes, helper functions,
and fallback behaviour for the most complex endpoints.

Updated for CRITICAL DIRECTIVE: state machine changes mean AI decisions
map to pending_payer_decision, not directly to approved/denied.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app

_AUTH = {"Authorization": "Bearer dev-token"}


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


# ─── Helper unit tests ───────────────────────────────────────────────────

def test_mask_nid_empty():
    from src.api.routes.bff import _mask_nid
    assert _mask_nid("") == ""


def test_mask_nid_short():
    from src.api.routes.bff import _mask_nid
    assert _mask_nid("1234") == "****"


def test_mask_nid_14_digit():
    from src.api.routes.bff import _mask_nid
    result = _mask_nid("29901011234567")
    assert result.endswith("4567")
    assert result.startswith("*")
    assert len(result) == 14


def _make_row(
    adjudication_decision=None,
    completed_at=None,
    fraud_score=None,
    correlation_id="test-corr",
):
    """Helper to create a SimpleNamespace row with all required attributes."""
    return SimpleNamespace(
        correlation_id=correlation_id,
        adjudication_decision=adjudication_decision,
        completed_at=completed_at,
        fraud_score=fraud_score,
    )


def test_status_from_row_approved():
    """AI 'approved' recommendation → pending_payer_decision (not approved!)."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="approved", completed_at=datetime.now())
    assert _status_from_row(row) == "pending_payer_decision"


def test_status_from_row_denied():
    """AI 'denied' recommendation → pending_payer_decision (not denied!)."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="denied", completed_at=datetime.now())
    assert _status_from_row(row) == "pending_payer_decision"


def test_status_from_row_pended():
    """AI 'pended' recommendation → pending_payer_decision."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="pended", completed_at=datetime.now())
    assert _status_from_row(row) == "pending_payer_decision"


def test_status_from_row_partial():
    """AI 'partial' recommendation → pending_payer_decision."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="partial", completed_at=datetime.now())
    assert _status_from_row(row) == "pending_payer_decision"


def test_status_from_row_voided():
    """voided should still map to 'voided'."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="voided", completed_at=datetime.now())
    assert _status_from_row(row) == "voided"


def test_status_from_row_settled():
    """AI 'settled' recommendation → pending_payer_decision (payer decides)."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="settled", completed_at=datetime.now())
    assert _status_from_row(row) == "pending_payer_decision"


def test_status_from_row_investigating():
    """investigating should still map to 'investigating'."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision="investigating", completed_at=datetime.now())
    assert _status_from_row(row) == "investigating"


def test_status_from_row_none():
    """No AI decision and not completed → under_ai_review."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(adjudication_decision=None, completed_at=None)
    assert _status_from_row(row) == "under_ai_review"


def test_status_from_row_high_fraud_score():
    """High fraud score (>=0.8) → investigating regardless of AI decision."""
    from src.api.routes.bff import _status_from_row
    row = _make_row(
        adjudication_decision="approved",
        completed_at=datetime.now(),
        fraud_score=0.85,
    )
    assert _status_from_row(row) == "investigating"


def test_status_from_row_payer_decision_in_cache():
    """When payer decision exists in cache, it overrides AI recommendation."""
    from src.api.routes.bff import _payer_decisions_cache, _status_from_row
    corr_id = "test-payer-override"
    _payer_decisions_cache[corr_id] = "approved"
    try:
        row = _make_row(
            adjudication_decision="denied",
            completed_at=datetime.now(),
            correlation_id=corr_id,
        )
        assert _status_from_row(row) == "approved"
    finally:
        _payer_decisions_cache.pop(corr_id, None)


# ─── Provider summary fallback ───────────────────────────────────────────

def test_provider_summary_fallback_shape(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get("/internal/ai/bff/provider/summary", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "claims_today" in data
    assert "denial_rate_30d" in data
    assert "payments_this_month_egp" in data
    assert "claim_status_distribution" in data
    assert isinstance(data["claim_status_distribution"], list)


def test_payer_summary_fallback_shape(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get("/internal/ai/bff/payer/summary", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "queue_depth" in data
    assert "approval_rate" in data
    assert "avg_processing_minutes" in data


def test_siu_summary_fallback_shape(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get("/internal/ai/bff/siu/summary", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "flagged_total" in data
    assert "risk_distribution" in data
    assert isinstance(data["risk_distribution"], list)


def test_regulatory_summary_fallback_shape(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get("/internal/ai/bff/regulatory/summary", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_claims_volume" in data
    assert "trend_by_month" in data


# ─── Claims list ─────────────────────────────────────────────────────────

def test_claims_list_empty_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get(
            "/internal/ai/bff/claims?portal=provider&limit=5",
            headers=_AUTH,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_claims_list_siu_portal_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get(
            "/internal/ai/bff/claims?portal=siu&status=denied",
            headers=_AUTH,
        )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


# ─── SIU network ─────────────────────────────────────────────────────────

def test_siu_network_returns_graph_shape(client):
    resp = client.get(
        "/internal/ai/bff/siu/network?fraud_min=0.4",
        headers=_AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    assert len(data["nodes"]) >= 1
    for node in data["nodes"]:
        assert "id" in node
        assert "type" in node


# ─── Provider preauth ────────────────────────────────────────────────────

def test_provider_preauth_list_returns_items(client):
    resp = client.get(
        "/internal/ai/bff/provider/preauth",
        headers=_AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    if data["items"]:
        item = data["items"][0]
        assert "request_id" in item
        assert "claim_type" in item
        assert "patient_nid_masked" in item


def test_create_preauth_returns_item(client):
    resp = client.post(
        "/internal/ai/bff/provider/preauth",
        headers=_AUTH,
        json={
            "patient_nid": "29901011234567",
            "icd10": "M54.5",
            "procedure": "MRI Lumbar",
            "amount": 4200.0,
            "justification": "Test justification",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["request_id"].startswith("PA-")
    assert data["status"] == "submitted"


# ─── SIU reports ──────────────────────────────────────────────────────────

def test_siu_reports_list(client):
    resp = client.get("/internal/ai/bff/siu/reports", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) >= 1


def test_generate_siu_report(client):
    resp = client.post(
        "/internal/ai/bff/siu/reports/generate",
        headers=_AUTH,
        json={"type": "weekly"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "weekly"
    assert "download_url" in data


# ─── Regulatory reports ──────────────────────────────────────────────────

def test_regulatory_reports_list(client):
    resp = client.get("/internal/ai/bff/regulatory/reports", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) >= 1


def test_generate_regulatory_report(client):
    resp = client.post(
        "/internal/ai/bff/regulatory/reports/generate",
        headers=_AUTH,
        json={"type": "monthly"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "monthly"
    assert data["status"] == "ready"
    assert "download_url" in data


# ─── Provider settings ───────────────────────────────────────────────────

def test_provider_settings_get(client):
    resp = client.get("/internal/ai/bff/provider/settings", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "profile" in data
    assert "notifications" in data


# ─── Regulatory insurers ─────────────────────────────────────────────────

def test_regulatory_insurers_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        resp = client.get("/internal/ai/bff/regulatory/insurers", headers=_AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "name" in data[0]


# ─── CRITICAL DIRECTIVE: New endpoint tests ──────────────────────────────

def test_payer_claim_decision_endpoint(client):
    """Test the payer claim decision endpoint (mocked Redis)."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.setex = _async_noop
        mock_redis.lpush = _async_noop
        with patch(
            "src.api.routes.bff.create_engine_and_session",
            side_effect=RuntimeError("no db"),
        ):
            resp = client.post(
                "/internal/ai/bff/claims/test-corr-123/decision",
                headers=_AUTH,
                json={"decision": "approved", "reason": "Looks good"},
            )
    assert resp.status_code == 200
    data = resp.json()
    assert data["correlation_id"] == "test-corr-123"
    assert data["decision"] == "approved"
    assert data["status"] == "approved"
    assert "decided_at" in data


def test_payer_claim_decision_denied(client):
    """Test the payer claim decision endpoint with denial."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.setex = _async_noop
        mock_redis.lpush = _async_noop
        with patch(
            "src.api.routes.bff.create_engine_and_session",
            side_effect=RuntimeError("no db"),
        ):
            resp = client.post(
                "/internal/ai/bff/claims/test-corr-456/decision",
                headers=_AUTH,
                json={"decision": "denied", "reason": "Missing documentation"},
            )
    assert resp.status_code == 200
    data = resp.json()
    assert data["decision"] == "denied"


def test_provider_communications_reply(client):
    """Test provider communications reply endpoint."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.lpush = _async_noop
        mock_redis.expire = _async_noop
        resp = client.post(
            "/internal/ai/bff/provider/communications/thread-001/reply",
            headers=_AUTH,
            json={"body": "Thank you for the update."},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["direction"] == "outbound"
    assert data["from_name"] == "Provider"
    assert data["body"] == "Thank you for the update."


def test_payer_communications_reply(client):
    """Test payer communications reply endpoint."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.lpush = _async_noop
        mock_redis.expire = _async_noop
        resp = client.post(
            "/internal/ai/bff/payer/communications/thread-002/reply",
            headers=_AUTH,
            json={"body": "Please provide more details."},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["direction"] == "outbound"
    assert data["from_name"] == "Payer"


def test_payer_preauth_list(client):
    """Test payer pre-auth list endpoint returns items."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.lrange = _async_return([])
        with patch(
            "src.api.routes.bff.create_engine_and_session",
            side_effect=RuntimeError("no db"),
        ):
            resp = client.get(
                "/internal/ai/bff/payer/preauth",
                headers=_AUTH,
            )
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) >= 1  # fallback seed data


def test_payer_preauth_decision(client):
    """Test payer pre-auth decision endpoint."""
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = mock_redis_cls.return_value
        mock_redis.setex = _async_noop
        resp = client.post(
            "/internal/ai/bff/payer/preauth/decision",
            headers=_AUTH,
            json={
                "request_id": "PA-2026-001",
                "status": "approved",
                "reason": "Medically necessary",
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["request_id"] == "PA-2026-001"
    assert data["status"] == "approved"


# ─── Async mock helpers ─────────────────────────────────────────────────

async def _async_noop(*args, **kwargs):
    """Async no-op for mocking Redis methods."""
    return None


def _async_return(value):
    """Create an async function that returns a specific value."""
    async def _inner(*args, **kwargs):
        return value
    return _inner


# ─── Tests for _refresh_payer_decisions (cross-worker sync) ──────────


def test_refresh_payer_decisions_populates_cache(client):
    """
    _refresh_payer_decisions should batch-load decisions from Redis
    and merge them into the module-level cache.
    """
    import asyncio
    import json as _json

    from src.api.routes.bff import (
        _payer_decisions_cache,
        _refresh_payer_decisions,
    )

    _payer_decisions_cache.clear()

    mock_redis = type("R", (), {
        "mget": _async_return([
            _json.dumps({"decision": "approved"}),
            _json.dumps({"decision": "denied"}),
            None,
        ]),
    })()

    with patch(
        "src.api.routes.bff.RedisService",
        return_value=mock_redis,
    ):
        asyncio.get_event_loop().run_until_complete(
            _refresh_payer_decisions(
                ["corr-1", "corr-2", "corr-3"]
            )
        )

    assert _payer_decisions_cache.get("corr-1") == "approved"
    assert _payer_decisions_cache.get("corr-2") == "denied"
    assert "corr-3" not in _payer_decisions_cache
    _payer_decisions_cache.clear()


def test_refresh_payer_decisions_empty_list(client):
    """_refresh_payer_decisions with empty list is a no-op."""
    import asyncio

    from src.api.routes.bff import _refresh_payer_decisions

    asyncio.get_event_loop().run_until_complete(
        _refresh_payer_decisions([])
    )


def test_refresh_payer_decisions_redis_error(client):
    """_refresh_payer_decisions handles Redis errors gracefully."""
    import asyncio

    from src.api.routes.bff import _refresh_payer_decisions

    mock_redis = type("R", (), {
        "mget": _async_noop_raise,
    })()

    with patch(
        "src.api.routes.bff.RedisService",
        return_value=mock_redis,
    ):
        asyncio.get_event_loop().run_until_complete(
            _refresh_payer_decisions(["corr-1"])
        )


# ─── Tests for RedisService.mget ─────────────────────────────────────


def test_redis_mget_returns_values():
    """RedisService.mget should return values for given keys."""
    import asyncio

    from src.services.redis_service import RedisService

    mock_client = type("C", (), {
        "mget": _async_return(["val1", None, "val3"]),
    })()

    svc = RedisService.__new__(RedisService)
    svc._client = mock_client

    result = asyncio.get_event_loop().run_until_complete(
        svc.mget(["k1", "k2", "k3"])
    )
    assert result == ["val1", None, "val3"]


def test_redis_mget_empty_keys():
    """RedisService.mget with empty keys returns empty list."""
    import asyncio

    from src.services.redis_service import RedisService

    svc = RedisService.__new__(RedisService)
    result = asyncio.get_event_loop().run_until_complete(
        svc.mget([])
    )
    assert result == []


def test_redis_mget_error_returns_nones():
    """RedisService.mget should return Nones on error."""
    import asyncio

    from src.services.redis_service import RedisService

    mock_client = type("C", (), {
        "mget": _async_noop_raise,
    })()

    svc = RedisService.__new__(RedisService)
    svc._client = mock_client

    result = asyncio.get_event_loop().run_until_complete(
        svc.mget(["k1", "k2"])
    )
    assert result == [None, None]


async def _async_noop_raise(*args, **kwargs):
    """Async function that raises RuntimeError for testing."""
    raise RuntimeError("connection lost")
