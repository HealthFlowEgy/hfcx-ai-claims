
import pytest
from unittest.mock import AsyncMock, patch
from src.models.schemas import AICoordinateResponse, AdjudicationDecision

@pytest.mark.asyncio
async def test_coordinate_claim_sync(async_client, service_jwt, raw_fhir_bundle, sample_claim):
    """Test the synchronous coordinate endpoint."""
    with patch("src.api.routes.coordinator.get_coordinator") as mock_get_coord, \
         patch("src.api.routes.coordinator.ClaimAnalysisWriter.persist", new_callable=AsyncMock) as mock_persist:
        
        mock_coord = AsyncMock()
        mock_coord.process_claim.return_value = AICoordinateResponse(
            correlation_id=sample_claim.hcx_correlation_id,
            claim_id=sample_claim.claim_id,
            adjudication_decision=AdjudicationDecision.APPROVED,
            overall_confidence=0.95,
            requires_human_review=False,
            human_review_reasons=[],
            processing_time_ms=100,
            model_versions={"coordinator": "v1"},
            fhir_extensions=[]
        )
        mock_get_coord.return_value = mock_coord
        
        headers = {"Authorization": f"Bearer {service_jwt}"}
        payload = {
            "fhir_claim_bundle": raw_fhir_bundle,
            "hcx_headers": {
                "x-hcx-sender_code": "test",
                "x-hcx-recipient_code": "test",
                "x-hcx-correlation_id": "test",
                "x-hcx-workflow_id": "test",
                "x-hcx-api_call_id": "test",
                "x-hcx-timestamp": "2026-04-18T12:00:00Z"
            }
        }
        
        response = await async_client.post("/internal/ai/coordinate", json=payload, headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["claim_id"] == sample_claim.claim_id
        assert data["adjudication_decision"] == "approved"
        mock_persist.assert_called_once()

@pytest.mark.asyncio
async def test_coordinate_claim_async_and_status(async_client, service_jwt, raw_fhir_bundle, sample_claim):
    """Test the async coordinate and status polling endpoints."""
    with patch("src.api.routes.coordinator.get_coordinator") as mock_get_coord, \
         patch("src.api.routes.coordinator.ClaimAnalysisWriter.persist", new_callable=AsyncMock) as mock_persist:
        
        mock_coord = AsyncMock()
        # Mocking the actual processing that would happen in background
        mock_coord.process_claim.return_value = AICoordinateResponse(
            correlation_id=sample_claim.hcx_correlation_id,
            claim_id=sample_claim.claim_id,
            adjudication_decision=AdjudicationDecision.APPROVED,
            overall_confidence=0.95,
            requires_human_review=False,
            human_review_reasons=[],
            processing_time_ms=100,
            model_versions={"coordinator": "v1"},
            fhir_extensions=[]
        )
        mock_get_coord.return_value = mock_coord
        
        headers = {"Authorization": f"Bearer {service_jwt}"}
        payload = {
            "fhir_claim_bundle": raw_fhir_bundle,
            "hcx_headers": {
                "x-hcx-sender_code": "test",
                "x-hcx-recipient_code": "test",
                "x-hcx-correlation_id": "test",
                "x-hcx-workflow_id": "test",
                "x-hcx-api_call_id": "test",
                "x-hcx-timestamp": "2026-04-18T12:00:00Z"
            }
        }
        
        # 1. Submit Async
        response = await async_client.post("/internal/ai/coordinate/async", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        claim_id = data["claim_id"]
        assert data["status"] == "processing"
        
        # 2. Poll Status (might be processing or completed depending on timing, but we mock)
        # We'll wait a bit to let the background task finish or just check it exists
        response = await async_client.get(f"/internal/ai/coordinate/status/{claim_id}", headers=headers)
        assert response.status_code == 200
        status_data = response.json()
        assert status_data["status"] in ["processing", "completed"]
