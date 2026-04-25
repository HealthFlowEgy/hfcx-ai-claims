"""
Tests for the BFF routes consumed by the Next.js portals.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def test_provider_summary_returns_fallback_without_db(client):
    # The fallback returns a zeroed summary rather than 500 when the DB
    # is unreachable, so the frontend can still render its KPI cards.
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        response = client.get(
            "/internal/ai/bff/provider/summary",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["claims_today"] == 0
    assert data["denial_rate_30d"] == 0.0
    assert data["claim_status_distribution"] == []


def test_payer_summary_returns_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        response = client.get(
            "/internal/ai/bff/payer/summary",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["queue_depth"] == 0
    assert data["approval_rate"] == 0.0


def test_siu_summary_returns_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        response = client.get(
            "/internal/ai/bff/siu/summary",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["flagged_total"] == 0
    assert data["risk_distribution"] == []


def test_regulatory_summary_returns_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        response = client.get(
            "/internal/ai/bff/regulatory/summary",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["total_claims_volume"] == 0
    assert data["trend_by_month"] == []


def test_claims_list_returns_empty_fallback(client):
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        response = client.get(
            "/internal/ai/bff/claims?portal=provider&limit=10",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_siu_network_returns_scaffold_graph(client):
    response = client.get(
        "/internal/ai/bff/siu/network?fraud_min=0.4",
        headers={"Authorization": "Bearer dev-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["nodes"]) >= 2
    types = {n["type"] for n in data["nodes"]}
    assert "provider" in types
    assert len(data["edges"]) >= 1


def test_bff_mask_nid_helper():
    from src.api.routes.bff import _mask_nid

    assert _mask_nid("") == ""
    assert _mask_nid("12") == "**"
    assert _mask_nid("29901011234567") == "**********4567"


def test_bff_status_from_row_helper():
    """
    Updated for CRITICAL DIRECTIVE state machine:
    - AI decisions no longer map directly to approved/denied
    - Instead they map to pending_payer_decision (waiting for human payer)
    - Only payer decisions (in Redis cache) produce approved/denied
    """
    from datetime import datetime
    from types import SimpleNamespace

    from src.api.routes.bff import _status_from_row

    # AI completed with "approved" recommendation → pending_payer_decision (not approved!)
    assert _status_from_row(SimpleNamespace(
        correlation_id="test-1", adjudication_decision="approved",
        completed_at=datetime.now(), fraud_score=0.1,
    )) == "pending_payer_decision"

    # AI completed with "denied" recommendation → pending_payer_decision (not denied!)
    assert _status_from_row(SimpleNamespace(
        correlation_id="test-2", adjudication_decision="denied",
        completed_at=datetime.now(), fraud_score=0.1,
    )) == "pending_payer_decision"

    # AI not yet completed → under_ai_review
    assert _status_from_row(SimpleNamespace(
        correlation_id="test-3", adjudication_decision=None,
        completed_at=None, fraud_score=None,
    )) == "under_ai_review"

    # AI completed with no decision → pending_payer_decision
    assert _status_from_row(SimpleNamespace(
        correlation_id="test-4", adjudication_decision=None,
        completed_at=datetime.now(), fraud_score=None,
    )) == "pending_payer_decision"


def test_bff_claims_list_supports_siu_and_search(client):
    # Exercise the siu + status + search branches of list_claims.
    with patch(
        "src.api.routes.bff.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        r1 = client.get(
            "/internal/ai/bff/claims?portal=siu&status=denied,investigating&search=CL",
            headers={"Authorization": "Bearer dev-token"},
        )
    assert r1.status_code == 200
    assert r1.json() == {"items": [], "total": 0}
