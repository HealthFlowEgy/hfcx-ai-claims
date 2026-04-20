"""
Unit tests for MultimodalDocumentAgent (SRS §2.2 scaffold).
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.multimodal import MultimodalDocumentAgent


@pytest.mark.asyncio
async def test_disabled_by_default(sample_claim, monkeypatch):
    monkeypatch.setattr(
        "src.agents.multimodal.settings.multimodal_enabled",
        False,
        raising=False,
    )
    agent = MultimodalDocumentAgent()
    result = await agent.analyze(sample_claim)
    assert result.enabled is False
    assert result.processed == 0


@pytest.mark.asyncio
async def test_empty_attachments_returns_empty(sample_claim, monkeypatch):
    monkeypatch.setattr(
        "src.agents.multimodal.settings.multimodal_enabled",
        True,
        raising=False,
    )
    sample_claim.attachment_ids = []
    agent = MultimodalDocumentAgent()
    result = await agent.analyze(sample_claim)
    assert result.enabled is True
    assert result.processed == 0
    assert result.skipped == 0


@pytest.mark.asyncio
async def test_fetch_failure_increments_failed(sample_claim, monkeypatch):
    monkeypatch.setattr(
        "src.agents.multimodal.settings.multimodal_enabled",
        True,
        raising=False,
    )
    sample_claim.attachment_ids = ["doc-1"]

    agent = MultimodalDocumentAgent()
    # Force fetch to raise
    with patch.object(
        agent, "_fetch_attachment", AsyncMock(side_effect=RuntimeError("boom"))
    ):
        result = await agent.analyze(sample_claim)
    assert result.failed == 1
    assert result.processed == 0


@pytest.mark.asyncio
async def test_successful_analysis(sample_claim, monkeypatch):
    monkeypatch.setattr(
        "src.agents.multimodal.settings.multimodal_enabled",
        True,
        raising=False,
    )
    sample_claim.attachment_ids = ["doc-1"]

    agent = MultimodalDocumentAgent()
    llm_response = MagicMock()
    llm_response.raise_for_status = MagicMock(return_value=None)
    llm_response.json = MagicMock(
        return_value={
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": "Patient has acute URI.",
                                "diagnoses": ["J06.9"],
                                "medications": ["EDA-AMOX-500"],
                                "notes": ["Prescribed 7-day amoxicillin"],
                            }
                        )
                    }
                }
            ]
        }
    )

    # ISSUE-053: Mock complete_vision instead of private _get_shared_client
    vision_content = json.dumps({
        "summary": "Patient has acute URI.",
        "diagnoses": ["J06.9"],
        "medications": ["EDA-AMOX-500"],
        "notes": ["Prescribed 7-day amoxicillin"],
    })

    with patch.object(
        agent, "_fetch_attachment", AsyncMock(return_value=b"\xff\xd8\xff\xe0")
    ), patch.object(
        agent._llm, "complete_vision", AsyncMock(return_value=vision_content),
    ):
        result = await agent.analyze(sample_claim)

    assert result.processed == 1
    assert result.failed == 0
    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding["attachment_id"] == "doc-1"
    assert "J06.9" in finding["diagnoses"]


@pytest.mark.asyncio
async def test_skipped_when_blob_not_found(sample_claim, monkeypatch):
    monkeypatch.setattr(
        "src.agents.multimodal.settings.multimodal_enabled",
        True,
        raising=False,
    )
    sample_claim.attachment_ids = ["doc-missing"]

    agent = MultimodalDocumentAgent()
    with patch.object(agent, "_fetch_attachment", AsyncMock(return_value=None)):
        result = await agent.analyze(sample_claim)
    assert result.skipped == 1
