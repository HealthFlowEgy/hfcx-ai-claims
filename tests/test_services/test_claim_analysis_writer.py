"""
Tests for the ClaimAnalysisWriter (P0 review fix).
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    ClaimAnalysisState,
    FraudDetectionResult,
    RiskLevel,
)
from src.services.claim_analysis_writer import (
    ClaimAnalysisWriter,
    _decision_to_recommendation,
    _hash_nid,
    _mask_nid,
)


def test_hash_nid_is_truncated_sha256():
    assert _hash_nid(None) is None
    assert _hash_nid("") is None
    h = _hash_nid("29901011234567")
    assert h is not None
    assert len(h) == 16
    assert _hash_nid("29901011234567") == _hash_nid("29901011234567")
    assert _hash_nid("29901011234568") != h


def test_mask_nid_hides_all_but_last_four():
    assert _mask_nid(None) is None
    assert _mask_nid("") is None
    assert _mask_nid("ab") == "**"
    assert _mask_nid("29901011234567") == "**********4567"


def test_decision_to_recommendation_enum_mapping():
    assert _decision_to_recommendation("approved") == "approve"
    assert _decision_to_recommendation("denied") == "deny"
    assert _decision_to_recommendation("pended") == "investigate"
    assert _decision_to_recommendation("partial") == "investigate"
    assert _decision_to_recommendation(None) is None
    assert _decision_to_recommendation("something-else") is None


@pytest.mark.asyncio
async def test_build_row_captures_metadata_and_agent_results(sample_claim):
    analysis = ClaimAnalysisState(
        claim=sample_claim,
        correlation_id="corr-001",
        adjudication_decision=AdjudicationDecision.APPROVED,
        overall_confidence=0.91,
        requires_human_review=False,
        human_review_reasons=[],
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED,
            fraud_score=0.12,
            risk_level=RiskLevel.LOW,
        ),
        agent_durations_ms={"total": 2340},
        model_versions={"coordinator": "medgemma:27b", "app_version": "1.0.0"},
        completed_at=datetime.now(UTC),
    )

    row = ClaimAnalysisWriter._build_row(sample_claim, analysis)

    # Denormalized metadata
    assert row["claim_id"] == sample_claim.claim_id
    assert row["provider_id"] == sample_claim.provider_id
    assert row["payer_id"] == sample_claim.payer_id
    assert row["claim_type"] == sample_claim.claim_type.value
    assert row["total_amount"] == float(sample_claim.total_amount)
    assert row["patient_nid_hash"] is not None
    assert row["patient_nid_masked"] == "**********4567"
    assert row["service_date"] == sample_claim.service_date

    # SRS §5.1 derived columns
    assert row["risk_score"] == 0.12
    assert row["recommendation"] == "approve"
    assert row["confidence"] == 0.91

    # Agent JSONB blobs
    assert row["fraud_result"] is not None
    assert row["fraud_result"]["fraud_score"] == 0.12

    # Decision + review
    assert row["adjudication_decision"] == "approved"
    assert row["requires_human_review"] is False
    assert row["human_review_reasons"] == []

    # Denormalized fraud summary
    assert row["fraud_score"] == 0.12
    assert row["fraud_risk_level"] == "low"

    # Reproducibility
    assert row["model_versions"] == {
        "coordinator": "medgemma:27b",
        "app_version": "1.0.0",
    }

    # Performance
    assert row["processing_time_ms"] == 2340


@pytest.mark.asyncio
async def test_persist_swallows_errors_when_engine_unavailable(sample_claim):
    analysis = ClaimAnalysisState(
        claim=sample_claim,
        correlation_id="corr-err",
        adjudication_decision=AdjudicationDecision.PENDED,
    )

    with patch(
        "src.services.claim_analysis_writer.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    ):
        # Must not raise
        await ClaimAnalysisWriter.persist(claim=sample_claim, analysis=analysis)


@pytest.mark.asyncio
async def test_persist_executes_upsert_on_success(sample_claim):
    analysis = ClaimAnalysisState(
        claim=sample_claim,
        correlation_id="corr-ok",
        adjudication_decision=AdjudicationDecision.APPROVED,
        overall_confidence=0.95,
    )

    session = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)

    factory = MagicMock(return_value=session)
    with patch(
        "src.services.claim_analysis_writer.create_engine_and_session",
        return_value=(None, factory),
    ):
        await ClaimAnalysisWriter.persist(claim=sample_claim, analysis=analysis)

    session.execute.assert_awaited_once()
    session.commit.assert_awaited_once()
