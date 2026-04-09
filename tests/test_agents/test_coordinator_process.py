"""
Test the CoordinatorAgent.process_claim graceful-degradation path.

Exercises the bypass-on-failure branch that returns a PENDED decision
without spinning up the real LangGraph graph.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.agents.coordinator import CoordinatorAgent
from src.models.schemas import AdjudicationDecision


@pytest.mark.asyncio
async def test_process_claim_bypass_on_graph_error(sample_claim):
    agent = CoordinatorAgent()

    fake_graph = AsyncMock()
    fake_graph.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
    agent._graph = fake_graph
    agent._ready = True

    with patch(
        "src.agents.coordinator.settings.ai_bypass_on_failure", True
    ):
        result = await agent.process_claim(sample_claim)

    assert result.adjudication_decision == AdjudicationDecision.PENDED
    assert result.requires_human_review is True
    assert "AI layer error" in result.human_review_reasons[0]


@pytest.mark.asyncio
async def test_process_claim_happy_path(sample_claim):
    agent = CoordinatorAgent()

    async def _fake_invoke(state, config):
        return {
            "claim": sample_claim,
            "correlation_id": sample_claim.hcx_correlation_id,
            "adjudication_decision": AdjudicationDecision.APPROVED,
            "overall_confidence": 0.9,
            "requires_human_review": False,
            "human_review_reasons": [],
            "agent_durations_ms": {},
        }

    fake_graph = AsyncMock()
    fake_graph.ainvoke = _fake_invoke
    agent._graph = fake_graph
    agent._ready = True

    result = await agent.process_claim(sample_claim)
    assert result.adjudication_decision == AdjudicationDecision.APPROVED
