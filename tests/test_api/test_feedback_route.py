"""Tests for the /internal/ai/feedback endpoint."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def test_feedback_route_returns_drift_stats(client):
    fake_stats = {
        "accuracy": 0.92,
        "precision_fraud": 0.88,
        "recall_fraud": 0.81,
        "drift": 0.07,
        "window_size": 120,
    }
    with patch(
        "src.api.routes.feedback.DriftService.record_feedback",
        AsyncMock(return_value=fake_stats),
    ):
        response = client.post(
            "/internal/ai/feedback",
            json={
                "correlation_id": "corr-1",
                "ai_decision": "approved",
                "human_decision": "approved",
                "ai_score": 0.12,
            },
            headers={"Authorization": "Bearer dev-token"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["accuracy"] == 0.92
    assert data["drift"] == 0.07
