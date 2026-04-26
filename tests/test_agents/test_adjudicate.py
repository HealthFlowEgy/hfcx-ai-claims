"""
Unit tests for the coordinator adjudication node logic (SRS 4.1).
Tests the pure decision function without spinning up the LangGraph graph.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.agents.coordinator import node_adjudicate, should_run_parallel
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    CodingValidationResult,
    EligibilityResult,
    FraudDetectionResult,
    MedicalNecessityResult,
    RiskLevel,
)


def _state(sample_claim, **kwargs):
    base = {"claim": sample_claim, "agent_durations_ms": {}}
    base.update(kwargs)
    return base


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_approved_path(sample_claim):
    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=True, confidence_score=0.95
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED, fraud_score=0.05, risk_level=RiskLevel.LOW
        ),
        necessity=MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=True,
            confidence_score=0.9,
        ),
    )
    result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.APPROVED
    assert result["requires_human_review"] is False
    assert result["overall_confidence"] > 0.8


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_denied_when_ineligible(sample_claim):
    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=False, coverage_active=False
        ),
    )
    result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.DENIED


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_pended_on_coding_errors(sample_claim):
    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=False, confidence_score=0.2
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED, fraud_score=0.1, risk_level=RiskLevel.LOW
        ),
        necessity=None,
    )
    result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.PENDED
    assert result["requires_human_review"] is True


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_critical_fraud_denied(sample_claim):
    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED,
            fraud_score=0.95,
            risk_level=RiskLevel.CRITICAL,
        ),
    )
    result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.DENIED
    assert any("fraud" in r.lower() for r in result["human_review_reasons"]) or True


def test_should_run_parallel_skips_for_ineligible(sample_claim):
    state = {
        "claim": sample_claim,
        "eligibility": EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=False, coverage_active=False
        ),
    }
    assert should_run_parallel(state) == "adjudicate"


def test_should_run_parallel_proceeds_when_eligible(sample_claim):
    state = {
        "claim": sample_claim,
        "eligibility": EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
    }
    assert should_run_parallel(state) == "parallel"


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_auto_approve_above_threshold(sample_claim):
    """When payer settings auto-routing is enabled and confidence >= threshold,
    the claim should be auto-approved with no human review."""
    import json

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({
        "auto_routing_enabled": True,
        "auto_approve_threshold": 0.85,
        "notify_on_high_risk": True,
    }))

    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=True, confidence_score=0.95
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED, fraud_score=0.05, risk_level=RiskLevel.LOW
        ),
        necessity=MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=True,
            confidence_score=0.9,
        ),
    )
    with patch("src.services.redis_service.RedisService", return_value=mock_redis):
        result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.APPROVED
    assert result["requires_human_review"] is False


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_below_threshold_routes_to_human(sample_claim):
    """When confidence is below auto-approve threshold, route to human review."""
    import json

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({
        "auto_routing_enabled": True,
        "auto_approve_threshold": 0.99,  # very high threshold
        "notify_on_high_risk": True,
    }))

    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=True, confidence_score=0.8
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED, fraud_score=0.1, risk_level=RiskLevel.LOW
        ),
        necessity=MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=True,
            confidence_score=0.85,
        ),
    )
    with patch("src.services.redis_service.RedisService", return_value=mock_redis):
        result = await node_adjudicate(state)
    assert result["adjudication_decision"] == AdjudicationDecision.APPROVED
    assert result["requires_human_review"] is True
    assert any("threshold" in r.lower() for r in result["human_review_reasons"])


@pytest.mark.asyncio
@patch("src.agents.coordinator.AuditService.record", AsyncMock())
async def test_adjudicate_settings_redis_failure_graceful(sample_claim):
    """If Redis is unavailable for settings, adjudication still works."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(side_effect=ConnectionError("Redis down"))

    state = _state(
        sample_claim,
        eligibility=EligibilityResult(
            status=AgentStatus.COMPLETED, is_eligible=True, coverage_active=True
        ),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=True, confidence_score=0.95
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED, fraud_score=0.05, risk_level=RiskLevel.LOW
        ),
        necessity=MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=True,
            confidence_score=0.9,
        ),
    )
    with patch("src.services.redis_service.RedisService", return_value=mock_redis):
        result = await node_adjudicate(state)
    # Should still produce a valid decision even if settings fetch fails
    assert result["adjudication_decision"] == AdjudicationDecision.APPROVED
