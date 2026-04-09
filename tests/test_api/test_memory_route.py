"""Tests for the memory API routes."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def test_memory_store_success(client):
    with patch("src.api.routes.memory.AgentMemoryService") as mock_cls:
        svc = MagicMock()
        svc.store = AsyncMock(return_value=True)
        mock_cls.return_value = svc

        response = client.post(
            "/internal/ai/memory/store",
            json={
                "agent_name": "fraud",
                "claim_id": "CLAIM-001",
                "pattern_key": "provider:P1:billing",
                "pattern_value": {"flag": "upcoding"},
            },
            headers={"Authorization": "Bearer dev-token"},
        )
        assert response.status_code == 200
        assert response.json()["stored"] is True


def test_memory_context_returns_patterns(client):
    with patch("src.api.routes.memory.AgentMemoryService") as mock_cls:
        svc = MagicMock()
        svc.retrieve_agent_context = AsyncMock(
            return_value=[{"pattern_key": "k", "value": {"v": 1}}]
        )
        mock_cls.return_value = svc

        response = client.get(
            "/internal/ai/memory/context/fraud",
            headers={"Authorization": "Bearer dev-token"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["patterns"][0]["pattern_key"] == "k"
