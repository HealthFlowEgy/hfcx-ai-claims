"""
Unit tests for MedicalNecessityAgent (SRS 4.5).
ChromaDB and LLM are mocked.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.medical_necessity import MedicalNecessityAgent
from src.models.schemas import AgentStatus


@pytest.mark.asyncio
@patch("src.agents.medical_necessity.LLMService")
async def test_necessity_happy_path(mock_llm_cls, sample_claim):
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(
        side_effect=[
            json.dumps(
                {
                    "is_necessary": True,
                    "confidence": 0.92,
                    "supporting_evidence": ["dx matches tx"],
                    "guidelines_referenced": ["MOH-001"],
                    "alternatives": [],
                }
            ),
            "ملخص بالعربية",
        ]
    )
    mock_llm_cls.return_value = mock_llm

    agent = MedicalNecessityAgent()
    # Stub ChromaDB collections to return empty
    agent._get_eda_collection = lambda: None  # type: ignore[assignment]
    agent._get_guidelines_collection = lambda: None  # type: ignore[assignment]

    result = await agent.assess(sample_claim)
    assert result.status == AgentStatus.COMPLETED
    assert result.is_medically_necessary is True
    assert result.confidence_score == 0.92
    assert result.arabic_summary.startswith("ملخص")


@pytest.mark.asyncio
@patch("src.agents.medical_necessity.LLMService")
async def test_necessity_llm_parse_fallback(mock_llm_cls, sample_claim):
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(return_value="not-json-at-all")
    mock_llm_cls.return_value = mock_llm

    agent = MedicalNecessityAgent()
    agent._get_eda_collection = lambda: None  # type: ignore[assignment]
    agent._get_guidelines_collection = lambda: None  # type: ignore[assignment]

    result = await agent.assess(sample_claim)
    assert result.status == AgentStatus.COMPLETED
    # Fallback: inconclusive but not blocking
    assert result.is_medically_necessary is True
    assert result.confidence_score == 0.5


def test_necessity_formulary_status_not_applicable_when_no_drugs():
    import asyncio
    agent = MedicalNecessityAgent()
    status = asyncio.run(agent._check_eda_formulary([], []))
    assert status == "not_applicable"


def test_necessity_formulary_status_from_metadata():
    import asyncio
    agent = MedicalNecessityAgent()
    ctx = [{"metadata": {"formulary_status": "restricted"}}]
    status = asyncio.run(agent._check_eda_formulary(["EDA-X"], ctx))
    assert status == "restricted"
