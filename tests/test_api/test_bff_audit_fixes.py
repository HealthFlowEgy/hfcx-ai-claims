"""Tests for audit-fix BFF endpoints added in the AUDIT-REPORT round.

Covers:
  - GET  /bff/claims/{correlation_id}  (claim detail / AI explainability)
  - POST /bff/provider/payments/transition  (payment lifecycle)
  - GET  /bff/siu/provider-profile/{provider_id}
  - GET  /bff/siu/beneficiary-risk/{patient_nid_hash}
  - GET  /bff/siu/reports/{report_id}/download
  - GET  /bff/regulatory/reports/{report_id}/download
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import create_app


@pytest.fixture()
def app():
    return create_app()


@pytest.fixture()
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _auth_header() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


# ── Claim detail endpoint ──────────────────────────────────────────────

@pytest.mark.asyncio()
async def test_claim_detail_not_found(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.create_engine_and_session") as mock_db:
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/claims/nonexistent-id",
            headers=_auth_header(),
        )
        assert resp.status_code == 404


@pytest.mark.asyncio()
async def test_claim_detail_returns_full_data(client: AsyncClient) -> None:
    mock_row = MagicMock()
    mock_row.claim_id = "CLAIM-001"
    mock_row.correlation_id = "corr-001"
    mock_row.patient_nid_masked = "****1234"
    mock_row.provider_id = "PROV-01"
    mock_row.payer_id = "PAY-01"
    mock_row.claim_type = "outpatient"
    mock_row.total_amount = 1500.0
    mock_row.fraud_score = 0.3
    mock_row.adjudication_decision = "approved"
    mock_row.created_at = datetime(2026, 4, 1, tzinfo=UTC)
    mock_row.completed_at = datetime(2026, 4, 1, tzinfo=UTC)
    mock_row.eligibility_result = {"is_eligible": True}
    mock_row.coding_result = {"all_codes_valid": True}
    mock_row.fraud_result = {"risk_level": "low"}
    mock_row.necessity_result = {"is_medically_necessary": True}
    mock_row.requires_human_review = False
    mock_row.human_review_reasons = []
    mock_row.overall_confidence = 0.92
    mock_row.processing_time_ms = 1200
    mock_row.model_versions = {"coordinator": "gpt-4.1-mini"}

    with (
        patch("src.api.routes.bff.create_engine_and_session") as mock_db,
        patch("src.api.routes.bff._refresh_payer_decisions", new_callable=AsyncMock),
    ):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_row
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/claims/corr-001",
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["claim_id"] == "CLAIM-001"
        assert data["eligibility_result"] == {"is_eligible": True}
        assert data["fraud_result"] == {"risk_level": "low"}
        assert data["overall_confidence"] == 0.92


# ── Payment lifecycle transition ───────────────────────────────────────

@pytest.mark.asyncio()
async def test_payment_transition_valid(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)  # no existing state = "initiated"
        mock_redis.setex = AsyncMock()
        mock_redis_cls.return_value = mock_redis

        resp = await client.post(
            "/internal/ai/bff/provider/payments/transition",
            json={
                "payment_ref": "PAY-00000001",
                "target_status": "evidence_uploaded",
                "evidence_url": "https://example.com/evidence.pdf",
            },
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "evidence_uploaded"


@pytest.mark.asyncio()
async def test_payment_transition_invalid(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.RedisService") as mock_redis_cls:
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)  # status = "initiated"
        mock_redis_cls.return_value = mock_redis

        resp = await client.post(
            "/internal/ai/bff/provider/payments/transition",
            json={
                "payment_ref": "PAY-00000001",
                "target_status": "completed",  # can't jump from initiated to completed
            },
            headers=_auth_header(),
        )
        assert resp.status_code == 422


# ── Provider fraud profile ─────────────────────────────────────────────

@pytest.mark.asyncio()
async def test_provider_fraud_profile_empty(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.create_engine_and_session") as mock_db:
        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/siu/provider-profile/PROV-01",
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_claims"] == 0
        assert data["avg_fraud_score"] == 0.0


# ── Beneficiary risk profile ──────────────────────────────────────────

@pytest.mark.asyncio()
async def test_beneficiary_risk_empty(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.create_engine_and_session") as mock_db:
        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/siu/beneficiary-risk/hash123",
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        data = resp.json()
        # When no real data exists, the endpoint returns a deterministic
        # mock profile so the scorecard always renders on the frontend.
        assert data["total_claims"] > 0
        assert data["risk_level"] in ("low", "medium", "high")


# ── SIU report download ───────────────────────────────────────────────

@pytest.mark.asyncio()
async def test_siu_report_download_csv(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.create_engine_and_session") as mock_db:
        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/siu/reports/rpt-001/download",
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "Claim ID" in resp.text


# ── Regulatory report download ────────────────────────────────────────

@pytest.mark.asyncio()
async def test_regulatory_report_download_csv(client: AsyncClient) -> None:
    with patch("src.api.routes.bff.create_engine_and_session") as mock_db:
        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_factory = MagicMock(return_value=mock_session)
        mock_db.return_value = (MagicMock(), mock_factory)

        resp = await client.get(
            "/internal/ai/bff/regulatory/reports/rpt-001/download",
            headers=_auth_header(),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "AI Decision" in resp.text
