"""
API integration tests (SRS Section 9 — testcontainers + pytest-asyncio).
Tests run against FastAPI TestClient with mocked AI agents.
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    ClaimAnalysisState,
    CodingValidationResult,
    EligibilityResult,
    FraudDetectionResult,
    MedicalNecessityResult,
    RiskLevel,
)


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


class TestHealthEndpoint:
    def test_health_returns_response(self, client):
        response = client.get("/internal/ai/health")
        # May be 200 or 503 depending on service availability
        assert response.status_code in (200, 503)

    def test_health_response_schema(self, client):
        with patch("src.api.routes.health.RedisService") as mock_redis_cls, \
             patch("src.api.routes.health.LLMService") as mock_llm_cls, \
             patch("src.api.routes.health._kafka_tcp_probe", return_value=True):
            mock_redis = AsyncMock()
            mock_redis.ping.return_value = True
            mock_redis_cls.return_value = mock_redis

            mock_llm = AsyncMock()
            mock_llm.get_model_status.return_value = {
                "coordinator": True, "coding": False, "arabic": False, "fast": True
            }
            mock_llm_cls.return_value = mock_llm

            response = client.get("/internal/ai/health")
            assert response.status_code in (200, 503)
            data = response.json()
            assert "status" in data
            assert "version" in data
            assert "models_available" in data
            assert "redis_connected" in data
            assert "kafka_connected" in data


class TestCoordinatorEndpoint:
    def test_coordinate_returns_analysis(self, client, sample_claim, raw_fhir_bundle):
        mock_parser = MagicMock()
        mock_parser.parse.return_value = sample_claim

        mock_analysis = ClaimAnalysisState(
            claim=sample_claim,
            correlation_id="test-001",
            adjudication_decision=AdjudicationDecision.APPROVED,
            overall_confidence=0.92,
            requires_human_review=False,
            human_review_reasons=[],
            eligibility=EligibilityResult(status=AgentStatus.COMPLETED, is_eligible=True),
            coding=CodingValidationResult(status=AgentStatus.COMPLETED, all_codes_valid=True),
            fraud=FraudDetectionResult(
                status=AgentStatus.COMPLETED, fraud_score=0.05, risk_level=RiskLevel.LOW
            ),
            necessity=MedicalNecessityResult(
                status=AgentStatus.COMPLETED, is_medically_necessary=True
            ),
        )

        mock_coordinator = MagicMock()
        mock_coordinator.process_claim = AsyncMock(return_value=mock_analysis)

        with patch("src.api.routes.coordinator._parser", mock_parser), \
             patch(
                 "src.api.routes.coordinator.get_coordinator",
                 return_value=mock_coordinator,
             ):
            response = client.post(
                "/internal/ai/coordinate",
                json={
                    "fhir_claim_bundle": raw_fhir_bundle,
                    "hcx_headers": {"X-HCX-Correlation-ID": "test-001"},
                },
                headers={"Authorization": "Bearer dev-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["adjudication_decision"] == "approved"
        assert data["overall_confidence"] == 0.92
        assert data["requires_human_review"] is False


class TestAgentEndpoints:
    def test_fraud_score_endpoint(self, client):
        with patch("src.api.routes.agents.FraudDetectionAgent") as mock_cls:
            mock_agent = MagicMock()
            mock_agent.score = AsyncMock(
                return_value=FraudDetectionResult(
                    status=AgentStatus.COMPLETED,
                    fraud_score=0.12,
                    risk_level=RiskLevel.LOW,
                )
            )
            mock_cls.return_value = mock_agent

            response = client.post(
                "/internal/ai/agents/fraud/score",
                json={
                    "claim_id": "CLAIM-001",
                    "provider_id": "PROV-001",
                    "patient_id": "29901011234567",
                    "total_amount": 850.0,
                    "diagnosis_codes": ["J06.9"],
                    "procedure_codes": ["99213"],
                    "claim_date": "2026-04-01T10:00:00",
                    "service_date": "2026-04-01T09:00:00",
                    "claim_type": "outpatient",
                },
                headers={"Authorization": "Bearer dev-token"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["fraud_score"] == 0.12
            assert data["risk_level"] == "low"

    def test_coding_validate_endpoint(self, client):
        with patch("src.api.routes.agents.MedicalCodingAgent") as mock_cls:
            mock_agent = MagicMock()
            mock_agent.validate = AsyncMock(
                return_value=CodingValidationResult(
                    status=AgentStatus.COMPLETED,
                    all_codes_valid=True,
                    confidence_score=0.97,
                )
            )
            mock_cls.return_value = mock_agent

            response = client.post(
                "/internal/ai/agents/coding/validate",
                json={
                    "diagnosis_codes": ["J06.9"],
                    "procedure_codes": ["99213"],
                    "clinical_notes": "Upper respiratory infection",
                    "claim_type": "outpatient",
                },
                headers={"Authorization": "Bearer dev-token"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["all_codes_valid"] is True


class TestLLMEndpoint:
    def test_llm_completion(self, client):
        with patch("src.api.routes.llm.LLMService") as mock_cls:
            mock_agent = MagicMock()
            mock_agent.complete = AsyncMock(return_value="42")
            mock_cls.return_value = mock_agent

            response = client.post(
                "/internal/ai/llm/completion",
                json={"prompt": "test"},
                headers={"Authorization": "Bearer dev-token"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["content"] == "42"
            assert data["model"]   # alias returned
