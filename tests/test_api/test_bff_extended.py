"""
ISSUE-064: Extended BFF route tests — covers response shapes, helper functions,
and fallback behaviour for the most complex endpoints.
"""
from __future__ import annotations

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
    assert _mask_nid("1234") == "1234"


def test_mask_nid_14_digit():
    from src.api.routes.bff import _mask_nid
    result = _mask_nid("29901011234567")
    assert result.endswith("4567")
    assert result.startswith("*")
    assert len(result) == 14


def test_status_from_row_approved():
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="approved")
    assert _status_from_row(row) == "approved"


def test_status_from_row_denied():
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="denied")
    assert _status_from_row(row) == "denied"


def test_status_from_row_pended():
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="pended")
    assert _status_from_row(row) == "in_review"


def test_status_from_row_partial():
    """ISSUE-026: partial should map to 'partial'."""
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="partial")
    assert _status_from_row(row) == "partial"


def test_status_from_row_voided():
    """ISSUE-026: voided should map to 'voided'."""
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="voided")
    assert _status_from_row(row) == "voided"


def test_status_from_row_settled():
    """ISSUE-026: settled should map to 'settled'."""
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="settled")
    assert _status_from_row(row) == "settled"


def test_status_from_row_investigating():
    """ISSUE-026: investigating should map to 'investigating'."""
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision="investigating")
    assert _status_from_row(row) == "investigating"


def test_status_from_row_none():
    from src.api.routes.bff import _status_from_row
    row = SimpleNamespace(adjudication_decision=None)
    assert _status_from_row(row) == "ai_analyzed"


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
    assert "insurers" in data
    assert isinstance(data["insurers"], list)
