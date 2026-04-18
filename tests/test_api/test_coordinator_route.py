from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_coordinate_claim_sync(async_client, service_jwt, raw_fhir_bundle, sample_claim):
    """Test the synchronous coordinate endpoint."""
    with patch("src.api.routes.coordinator.get_coordinator") as mock_get_coord, \
         patch(
             "src.api.routes.coordinator.ClaimAnalysisWriter.persist",
             new_callable=AsyncMock
         ) as mock_persist:

        mock_coord = AsyncMock()
        mock_coord.process.return_value = {
            "claim_id": sample_claim.id,
            "status": "completed",
            "decision": "APPROVED",
            "reasoning": "Test reasoning"
        }
        mock_get_coord.return_value = mock_coord

        headers = {"Authorization": f"Bearer {service_jwt}"}
        payload = {
            "claim_id": sample_claim.id,
            "bundle": raw_fhir_bundle,
            "metadata": {
                "provider_id": "test-provider",
                "payer_id": "test-payer"
            }
        }

        response = await async_client.post(
            "/internal/ai/coordinate/sync",
            json=payload,
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["claim_id"] == sample_claim.id
        assert data["status"] == "completed"
        assert data["decision"] == "APPROVED"

        # Verify persistence was called
        assert mock_persist.called

@pytest.mark.asyncio
async def test_coordinate_claim_async_and_status(
    async_client, service_jwt, raw_fhir_bundle, sample_claim
):
    """Test the async coordinate and status polling endpoints."""
    with patch("src.api.routes.coordinator.get_coordinator") as mock_get_coord, \
         patch(
             "src.api.routes.coordinator.ClaimAnalysisWriter.persist",
             new_callable=AsyncMock
         ):

        mock_coord = AsyncMock()
        mock_coord.process.return_value = {
            "claim_id": sample_claim.id,
            "status": "completed",
            "decision": "APPROVED",
            "reasoning": "Test reasoning"
        }
        mock_get_coord.return_value = mock_coord

        headers = {"Authorization": f"Bearer {service_jwt}"}
        payload = {
            "claim_id": sample_claim.id,
            "bundle": raw_fhir_bundle,
            "metadata": {
                "provider_id": "test-provider",
                "payer_id": "test-payer"
            }
        }

        # 1. Submit Async
        response = await async_client.post(
            "/internal/ai/coordinate/async",
            json=payload,
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        claim_id = data["claim_id"]
        assert data["status"] == "processing"

        # 2. Poll Status
        response = await async_client.get(
            f"/internal/ai/coordinate/status/{claim_id}",
            headers=headers
        )
        assert response.status_code == 200
        status_data = response.json()
        assert "status" in status_data
