"""
Tests for NDPService (FR-MC-003).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from src.services.ndp_service import NDPService


@pytest.mark.asyncio
async def test_ndp_returns_empty_for_no_drugs():
    svc = NDPService(client=AsyncMock())
    out = await svc.check_prescription(
        patient_id="29901011234567", drug_codes=[], prescription_id=None
    )
    assert out["unprescribed"] == []
    assert out["prescribed"] == []


@pytest.mark.asyncio
async def test_ndp_parses_response():
    client = MagicMock()
    response = MagicMock()
    response.raise_for_status = MagicMock(return_value=None)
    response.json = MagicMock(
        return_value={
            "prescribed": ["EDA-METFORMIN-500"],
            "dispensed": [],
            "unprescribed": ["EDA-GLIPIZIDE-5"],
            "prescription_matched": "RX-001",
        }
    )
    client.post = AsyncMock(return_value=response)

    svc = NDPService(client=client)
    out = await svc.check_prescription(
        patient_id="29901011234567",
        drug_codes=["EDA-METFORMIN-500", "EDA-GLIPIZIDE-5"],
        prescription_id="RX-001",
    )
    assert out["unprescribed"] == ["EDA-GLIPIZIDE-5"]
    assert out["prescription_matched"] == "RX-001"


@pytest.mark.asyncio
async def test_ndp_degrades_on_error():
    client = MagicMock()
    client.post = AsyncMock(side_effect=httpx.ConnectError("down"))

    svc = NDPService(client=client)
    out = await svc.check_prescription(
        patient_id="29901011234567",
        drug_codes=["EDA-X"],
        prescription_id=None,
    )
    # Graceful degradation: all drugs flagged as unprescribed
    assert "EDA-X" in out["unprescribed"]
    assert "error" in out
