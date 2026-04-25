"""
Unit tests for MedicalNecessityAgent (SRS 4.5).
ChromaDB and LLM are mocked.
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.medical_necessity import MedicalNecessityAgent
from src.models.schemas import AgentStatus


def _mock_guidelines_coll(docs):
    """Return a mock ChromaDB collection that returns docs."""
    coll = MagicMock()
    coll.query = MagicMock(
        return_value={
            "documents": [docs] if docs else [[]],
            "metadatas": [[{}] * len(docs)] if docs else [[]],
            "distances": [[0.1] * len(docs)] if docs else [[]],
        }
    )
    return coll


@pytest.mark.asyncio
@patch("src.agents.medical_necessity.LLMService")
async def test_necessity_happy_path_with_guidelines(
    mock_llm_cls, sample_claim
):
    """When guidelines ARE available, LLM is called."""
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
    agent._get_eda_collection = (
        lambda: None  # type: ignore[assignment]
    )
    agent._get_guidelines_collection = (  # type: ignore
        lambda: _mock_guidelines_coll(
            ["NHIA guideline: A00 oral rehydration"]
        )
    )

    result = await agent.assess(sample_claim)
    assert result.status == AgentStatus.COMPLETED
    assert result.is_medically_necessary is True
    assert result.confidence_score == 0.92


@pytest.mark.asyncio
@patch("src.agents.medical_necessity.LLMService")
async def test_necessity_no_guidelines_returns_inconclusive(
    mock_llm_cls, sample_claim
):
    """No guidelines → inconclusive, LLM NOT called."""
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(return_value="nope")
    mock_llm_cls.return_value = mock_llm

    agent = MedicalNecessityAgent()
    agent._get_eda_collection = (
        lambda: None  # type: ignore[assignment]
    )
    agent._get_guidelines_collection = (
        lambda: None  # type: ignore[assignment]
    )

    result = await agent.assess(sample_claim)
    assert result.status == AgentStatus.COMPLETED
    assert result.is_medically_necessary is None
    assert result.confidence_score == 0.0
    assert any(
        "no clinical guidelines" in e.lower()
        for e in result.supporting_evidence
    )
    mock_llm.complete.assert_not_called()


@pytest.mark.asyncio
@patch("src.agents.medical_necessity.LLMService")
async def test_necessity_llm_parse_fallback(
    mock_llm_cls, sample_claim
):
    """Unparseable LLM output → inconclusive (None)."""
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(return_value="not-json")
    mock_llm_cls.return_value = mock_llm

    agent = MedicalNecessityAgent()
    agent._get_eda_collection = (
        lambda: None  # type: ignore[assignment]
    )
    agent._get_guidelines_collection = (  # type: ignore
        lambda: _mock_guidelines_coll(
            ["NHIA guideline: E11 diabetes protocol"]
        )
    )

    result = await agent.assess(sample_claim)
    assert result.status == AgentStatus.COMPLETED
    assert result.is_medically_necessary is None
    assert result.confidence_score == 0.0


def test_necessity_formulary_not_applicable_no_drugs():
    agent = MedicalNecessityAgent()
    status = asyncio.run(
        agent._check_eda_formulary([], [])
    )
    assert status == "not_applicable"


def test_necessity_formulary_status_from_metadata():
    agent = MedicalNecessityAgent()
    ctx = [{"metadata": {"formulary_status": "restricted"}}]
    status = asyncio.run(
        agent._check_eda_formulary(["EDA-X"], ctx)
    )
    assert status == "restricted"
