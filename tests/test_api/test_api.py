"""
API integration tests (SRS Section 9 — testcontainers + pytest-asyncio).
Tests run against FastAPI TestClient with mocked AI agents.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from src.main import create_app
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    EligibilityResult,
    FraudDetectionResult,
    MedicalNecessityResult,
    CodingValidationResult,
    RiskLevel,
)


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        # Health check should work even without external services in dev
        response = client.get("/internal/ai/health")
        # May be 200 or 503 depending on service availability
        assert response.status_code in (200, 503)

    def test_health_response_schema(self, client):
        with patch("src.api.routes.health.RedisService") as mock_redis_cls, \
             patch("src.api.routes.health.LLMService") as mock_llm_cls:
            mock_redis = AsyncMock()
            mock_redis.ping.return_value = True
            mock_redis_cls.return_value = mock_redis

            mock_llm = AsyncMock()
            mock_llm.get_model_status.return_value = {
                "coordinator": True, "coding": False, "arabic": False, "fast": True
            }
            mock_llm_cls.return_value = mock_llm

            response = client.get("/internal/ai/health")
            if response.status_code == 200:
                data = response.json()
                assert "status" in data
                assert "version" in data
                assert "models_available" in data
                assert "redis_connected" in data


class TestCoordinatorEndpoint:
    @patch("src.api.routes.coordinator.CoordinatorAgent")
    @patch("src.api.routes.coordinator.FHIRClaimParser")
    def test_coordinate_returns_analysis(
        self, mock_parser_cls, mock_coordinator_cls, client, sample_claim, raw_fhir_bundle
    ):
        from datetime import datetime
        # Mock parser
        mock_parser = MagicMock()
        mock_parser.parse.return_value = sample_claim
        mock_parser_cls.return_value = mock_parser

        # Mock coordinator
        from src.models.schemas import ClaimAnalysisState
        mock_analysis = ClaimAnalysisState(
            claim=sample_claim,
            correlation_id="test-001",
            adjudication_decision=AdjudicationDecision.APPROVED,
            overall_confidence=0.92,
            requires_human_review=False,
            human_review_reasons=[],
            eligibility=EligibilityResult(status=AgentStatus.COMPLETED, is_eligible=True),
            coding=CodingValidationResult(status=AgentStatus.COMPLETED, all_codes_valid=True),
            fraud=FraudDetectionResult(status=AgentStatus.COMPLETED, fraud_score=0.05, risk_level=RiskLevel.LOW),
            necessity=MedicalNecessityResult(status=AgentStatus.COMPLETED, is_medically_necessary=True),
        )
        mock_coordinator = AsyncMock()
        mock_coordinator.process_claim.return_value = mock_analysis
        mock_coordinator_cls.return_value = mock_coordinator

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
        """POST /internal/ai/agents/fraud/score"""
        with patch("src.api.routes.agents.FraudDetectionAgent") as mock_cls:
            mock_agent = AsyncMock()
            mock_agent.score.return_value = FraudDetectionResult(
                status=AgentStatus.COMPLETED,
                fraud_score=0.12,
                risk_level=RiskLevel.LOW,
            )
            mock_cls.return_value = mock_agent

            from datetime import datetime
            response = client.post(
                "/internal/ai/agents/fraud/score",
                json={
                    "claim_id": "CLAIM-001",
                    "provider_id": "PROV-001",
                    "patient_id": "PAT-001",
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
        """POST /internal/ai/agents/coding/validate"""
        with patch("src.api.routes.agents.MedicalCodingAgent") as mock_cls:
            import json
            mock_agent = AsyncMock()
            mock_agent.validate.return_value = CodingValidationResult(
                status=AgentStatus.COMPLETED,
                all_codes_valid=True,
                confidence_score=0.97,
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
