"""Tests for src/api/routes/coordinator.py — sync, async, and status endpoints.

APP_ENV=development in the test env means verify_service_jwt is a no-op,
so we only need a syntactically valid Authorization header.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    EligibilityResult,
)

_AUTH = {"Authorization": "Bearer dev-token"}


def _mock_analysis():
    """Return a mock CoordinatorResult-like object."""
    mock = MagicMock()
    mock.correlation_id = "corr-test-001"
    mock.adjudication_decision = AdjudicationDecision.APPROVED
    mock.overall_confidence = 0.92
    mock.requires_human_review = False
    mock.human_review_reasons = []
    mock.eligibility = EligibilityResult(
        status=AgentStatus.COMPLETED,
        is_eligible=True,
        coverage_active=True,
    )
    mock.coding = None
    mock.fraud = None
    mock.necessity = None
    mock.model_versions = {"eligibility": "mock-v1"}
    return mock


_VALID_PAYLOAD = {
    "fhir_claim_bundle": {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
            {
                "resource": {
                    "resourceType": "Claim",
                    "id": "CLM-TEST-001",
                    "type": {
                        "coding": [{"code": "professional"}]
                    },
                    "patient": {
                        "reference": "Patient/29901011234567"
                    },
                    "provider": {
                        "reference": "Organization/HCP-EG-001"
                    },
                    "insurance": [
                        {
                            "coverage": {
                                "reference": "Coverage/MISR-001"
                            }
                        }
                    ],
                    "created": "2026-04-01T10:00:00",
                    "diagnosis": [
                        {
                            "sequence": 1,
                            "diagnosisCodeableConcept": {
                                "coding": [
                                    {
                                        "code": "J06.9",
                                        "system": (
                                            "http://hl7.org/fhir"
                                            "/sid/icd-10"
                                        ),
                                    }
                                ]
                            },
                        }
                    ],
                    "total": {
                        "value": 850.0,
                        "currency": "EGP",
                    },
                    "item": [
                        {
                            "sequence": 1,
                            "servicedDate": "2026-04-01",
                            "productOrService": {
                                "coding": [{"code": "99213"}]
                            },
                        }
                    ],
                }
            }
        ],
    },
    "hcx_headers": {
        "X-HCX-Sender-Code": "PROVIDER-EG-001",
        "X-HCX-Recipient-Code": "PAYER-EG-001",
        "X-HCX-Correlation-ID": "corr-test-001",
        "X-HCX-Workflow-ID": "wf-test-001",
        "X-HCX-API-Call-ID": "api-test-001",
    },
}


@pytest.mark.asyncio
async def test_coordinate_sync_success(async_client):
    """POST /internal/ai/coordinate returns 200."""
    analysis = _mock_analysis()

    with (
        patch(
            "src.api.routes.coordinator.get_coordinator"
        ) as mock_gc,
        patch(
            "src.api.routes.coordinator.ClaimAnalysisWriter"
        ) as mock_writer,
    ):
        coord = AsyncMock()
        coord.process_claim.return_value = analysis
        mock_gc.return_value = coord
        mock_writer.persist = AsyncMock()

        resp = await async_client.post(
            "/internal/ai/coordinate",
            json=_VALID_PAYLOAD,
            headers=_AUTH,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["adjudication_decision"] == "approved"
    assert body["correlation_id"] == "corr-test-001"


@pytest.mark.asyncio
async def test_coordinate_async_returns_processing(async_client):
    """POST /internal/ai/coordinate/async returns processing."""
    analysis = _mock_analysis()

    with (
        patch(
            "src.api.routes.coordinator.get_coordinator"
        ) as mock_gc,
        patch(
            "src.api.routes.coordinator.ClaimAnalysisWriter"
        ) as mock_writer,
    ):
        coord = AsyncMock()
        coord.process_claim.return_value = analysis
        mock_gc.return_value = coord
        mock_writer.persist = AsyncMock()

        resp = await async_client.post(
            "/internal/ai/coordinate/async",
            json=_VALID_PAYLOAD,
            headers=_AUTH,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "processing"
    assert "claim_id" in body


@pytest.mark.asyncio
async def test_coordinate_status_not_found(async_client):
    """GET /internal/ai/coordinate/status/{id} returns 404."""
    resp = await async_client.get(
        "/internal/ai/coordinate/status/NONEXISTENT-CLAIM",
        headers=_AUTH,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_coordinate_sync_invalid_bundle(async_client):
    """POST /internal/ai/coordinate with bad bundle returns error."""
    resp = await async_client.post(
        "/internal/ai/coordinate",
        json={
            "fhir_claim_bundle": {"invalid": True},
            "hcx_headers": {},
        },
        headers=_AUTH,
    )
    # 422 if FHIR parse fails first, 503 if coordinator/Redis unavailable
    assert resp.status_code in (422, 503)


@pytest.mark.asyncio
async def test_coordinate_sync_no_auth(async_client):
    """POST /internal/ai/coordinate without JWT returns 403."""
    resp = await async_client.post(
        "/internal/ai/coordinate",
        json=_VALID_PAYLOAD,
    )
    assert resp.status_code == 403
