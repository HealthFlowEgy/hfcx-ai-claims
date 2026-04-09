"""
Tests for DriftService (SRS §10.3 model accuracy/drift feedback loop).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.services.drift_service import DriftService


@pytest.fixture(autouse=True)
def _reset_drift():
    DriftService.reset()
    DriftService.set_baseline_mean_score(0.5)
    yield
    DriftService.reset()


@pytest.mark.asyncio
@patch("src.services.drift_service.AuditService.record", AsyncMock())
async def test_feedback_empty_window_then_first_event():
    stats = await DriftService.record_feedback(
        correlation_id="c1",
        ai_decision="approved",
        human_decision="approved",
        ai_score=0.12,
    )
    assert stats["window_size"] == 1
    assert stats["accuracy"] == 1.0


@pytest.mark.asyncio
@patch("src.services.drift_service.AuditService.record", AsyncMock())
async def test_precision_recall_on_positive_class():
    # 2 true positives, 1 false positive, 1 false negative.
    events = [
        ("c1", "denied", "denied", 0.90),
        ("c2", "denied", "denied", 0.88),
        ("c3", "denied", "approved", 0.70),
        ("c4", "approved", "denied", 0.45),
    ]
    for cid, ai, hum, score in events:
        await DriftService.record_feedback(
            correlation_id=cid,
            ai_decision=ai,
            human_decision=hum,
            ai_score=score,
        )

    stats = await DriftService.record_feedback(
        correlation_id="c5",
        ai_decision="approved",
        human_decision="approved",
        ai_score=0.10,
    )
    # accuracy = 3/5 correct → 0.6
    assert stats["window_size"] == 5
    assert stats["accuracy"] == 0.6
    # TP=2, FP=1, FN=1 → precision = 2/3, recall = 2/3
    assert stats["precision_fraud"] == round(2 / 3, 4)
    assert stats["recall_fraud"] == round(2 / 3, 4)


@pytest.mark.asyncio
@patch("src.services.drift_service.AuditService.record", AsyncMock())
async def test_drift_score_tracks_baseline_delta():
    DriftService.set_baseline_mean_score(0.2)
    # Feed a window of high-scoring events
    for i in range(10):
        await DriftService.record_feedback(
            correlation_id=f"c{i}",
            ai_decision="denied",
            human_decision="denied",
            ai_score=0.9,
        )
    stats = await DriftService.record_feedback(
        correlation_id="cfinal",
        ai_decision="denied",
        human_decision="denied",
        ai_score=0.9,
    )
    # Mean of ~0.9 vs baseline 0.2 → drift should be ≈ 0.7
    assert stats["drift"] > 0.5


@pytest.mark.asyncio
@patch("src.services.drift_service.AuditService.record", AsyncMock())
async def test_feedback_with_no_scores_has_zero_drift():
    await DriftService.record_feedback(
        correlation_id="c1",
        ai_decision="approved",
        human_decision="approved",
        ai_score=None,
    )
    stats = await DriftService.record_feedback(
        correlation_id="c2",
        ai_decision="approved",
        human_decision="approved",
        ai_score=None,
    )
    assert stats["drift"] == 0.0


@pytest.mark.asyncio
@patch("src.services.drift_service.AuditService.record", AsyncMock())
async def test_feedback_model_segmentation():
    """Metrics for different models should not cross-contaminate."""
    await DriftService.record_feedback(
        correlation_id="c1",
        ai_decision="denied",
        human_decision="denied",
        model="coordinator",
    )
    # Wrong answer — but with a different model, should not affect
    # coordinator accuracy.
    stats = await DriftService.record_feedback(
        correlation_id="c2",
        ai_decision="denied",
        human_decision="approved",
        model="fast",
    )
    assert stats["accuracy"] == 0.0  # fast model is 0/1
    assert stats["window_size"] == 1  # only fast-model events counted
