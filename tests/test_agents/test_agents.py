"""
Unit tests for AI agents (SRS Section 9 — pytest + pytest-cov, target 80%).
Uses mocked external dependencies — no live services required.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.fraud_detection import FraudDetectionAgent
from src.agents.medical_coding import MedicalCodingAgent
from src.models.schemas import AgentStatus, FHIRClaimBundle, RiskLevel


# ─────────────────────────────────────────────────────────────────────────────
# Fraud Detection Agent Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestFraudDetectionAgent:

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    async def test_low_value_claim_scores_low_risk(self, mock_redis_cls, sample_claim):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_redis.setex.return_value = True
        mock_redis_cls.return_value = mock_redis

        agent = FraudDetectionAgent()
        result = await agent.score(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        assert result.fraud_score is not None
        assert result.fraud_score < 0.45       # Low value claim → low risk
        assert result.risk_level == RiskLevel.LOW
        assert result.refer_to_siu is False

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    async def test_high_value_outpatient_flags_billing_pattern(
        self, mock_redis_cls, high_value_suspicious_claim
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_redis.setex.return_value = True
        mock_redis_cls.return_value = mock_redis

        agent = FraudDetectionAgent()
        result = await agent.score(high_value_suspicious_claim)

        assert result.status == AgentStatus.COMPLETED
        assert len(result.billing_pattern_flags) > 0
        # High amount flag
        assert any("unusually high" in f.lower() for f in result.billing_pattern_flags)
        # Late submission flag
        assert any("late claim" in f.lower() for f in result.billing_pattern_flags)
        # Missing docs flag
        assert any("documentation" in f.lower() for f in result.billing_pattern_flags)
        # Excessive codes flag
        assert any("excessive" in f.lower() for f in result.billing_pattern_flags)

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    async def test_duplicate_claim_detected(self, mock_redis_cls, sample_claim):
        mock_redis = AsyncMock()
        # Simulate existing claim in Redis (duplicate)
        mock_redis.get.side_effect = lambda key: (
            "EXISTING-CLAIM-ID" if "dup:" in key else None
        )
        mock_redis.setex.return_value = True
        mock_redis_cls.return_value = mock_redis

        agent = FraudDetectionAgent()
        result = await agent.score(sample_claim)

        assert any("duplicate" in f.lower() for f in result.billing_pattern_flags)

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    async def test_high_provider_score_triggers_network_indicator(
        self, mock_redis_cls, sample_claim
    ):
        import json
        mock_redis = AsyncMock()
        # Simulate provider with high rolling fraud score
        provider_data = json.dumps({
            "rolling_fraud_score": 0.82,
            "claim_count": 150,
            "score_sum": 123.0,
        })
        mock_redis.get.side_effect = lambda key: (
            provider_data if "provider_score" in key else None
        )
        mock_redis.setex.return_value = True
        mock_redis_cls.return_value = mock_redis

        agent = FraudDetectionAgent()
        result = await agent.score(sample_claim)

        assert len(result.network_risk_indicators) > 0
        assert result.refer_to_siu is True

    def test_risk_classification(self):
        agent = FraudDetectionAgent()
        assert agent._classify_risk(0.05) == RiskLevel.LOW
        assert agent._classify_risk(0.50) == RiskLevel.MEDIUM
        assert agent._classify_risk(0.80) == RiskLevel.HIGH
        assert agent._classify_risk(0.95) == RiskLevel.CRITICAL

    def test_feature_engineering_shape(self, sample_claim):
        agent = FraudDetectionAgent()
        features = agent._engineer_features(sample_claim)
        assert features.shape == (1, 10)
        assert features[0, 0] == sample_claim.total_amount


# ─────────────────────────────────────────────────────────────────────────────
# Medical Coding Agent Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestMedicalCodingAgent:

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    async def test_valid_icd10_format_accepted(self, mock_llm_cls, sample_claim):
        mock_llm = AsyncMock()
        import json
        mock_llm.complete.return_value = json.dumps({
            "icd10_validations": [
                {"code": "J06.9", "valid": True, "description": "Acute upper respiratory infection", "confidence": 0.98},
                {"code": "Z00.00", "valid": True, "description": "General adult medical examination", "confidence": 0.97},
            ],
            "procedure_validations": [],
            "suggested_corrections": [],
        })
        mock_llm_cls.return_value = mock_llm

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        assert result.all_codes_valid is True
        assert len(result.icd10_validations) == 2
        assert result.confidence_score > 0.9

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    async def test_invalid_icd10_format_flagged(self, mock_llm_cls, sample_claim):
        sample_claim.diagnosis_codes = ["INVALID", "J06.9"]
        mock_llm = AsyncMock()
        import json
        mock_llm.complete.return_value = json.dumps({
            "icd10_validations": [
                {"code": "INVALID", "valid": False, "description": None, "confidence": 0.1},
                {"code": "J06.9", "valid": True, "description": "URTI", "confidence": 0.98},
            ],
            "procedure_validations": [],
            "suggested_corrections": [
                {"original": "INVALID", "suggested": None, "reason": "Not a valid ICD-10 format"}
            ],
        })
        mock_llm_cls.return_value = mock_llm

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        # Format check catches INVALID before LLM
        invalid_entry = next(v for v in result.icd10_validations if v["code"] == "INVALID")
        assert invalid_entry["format_valid"] is False

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    async def test_arabic_entities_extracted_from_notes(self, mock_llm_cls, sample_claim):
        mock_llm = AsyncMock()
        import json
        # First call: Arabic NER extraction
        arabic_response = json.dumps({"entities": ["ارتفاع في درجة الحرارة", "ألم في الحلق"]})
        # Second call: ICD-10 validation
        coding_response = json.dumps({
            "icd10_validations": [
                {"code": c, "valid": True, "confidence": 0.95} for c in sample_claim.diagnosis_codes
            ],
            "procedure_validations": [],
            "suggested_corrections": [],
        })
        mock_llm.complete.side_effect = [arabic_response, coding_response]
        mock_llm_cls.return_value = mock_llm

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert len(result.arabic_entities_extracted) == 2
        assert "ارتفاع في درجة الحرارة" in result.arabic_entities_extracted


# ─────────────────────────────────────────────────────────────────────────────
# FHIR Parser Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestFHIRParser:

    def test_parse_bundle_extracts_claim(self, raw_fhir_bundle, sample_claim):
        from src.utils.fhir_parser import FHIRClaimParser
        parser = FHIRClaimParser()
        headers = {
            "X-HCX-Sender-Code": sample_claim.hcx_sender_code,
            "X-HCX-Recipient-Code": sample_claim.hcx_recipient_code,
            "X-HCX-Correlation-ID": sample_claim.hcx_correlation_id,
            "X-HCX-Workflow-ID": sample_claim.hcx_workflow_id,
            "X-HCX-API-Call-ID": sample_claim.hcx_api_call_id,
        }
        parsed = parser.parse(raw_fhir_bundle, headers)

        assert parsed.claim_id == sample_claim.claim_id
        assert parsed.patient_id == sample_claim.patient_id
        assert len(parsed.diagnosis_codes) == 2
        assert "J06.9" in parsed.diagnosis_codes
        assert parsed.total_amount == sample_claim.total_amount
        assert parsed.clinical_notes == sample_claim.clinical_notes

    def test_parse_direct_claim_resource(self, raw_fhir_bundle, sample_claim):
        """Parser should work with bare Claim resource (not wrapped in Bundle)."""
        from src.utils.fhir_parser import FHIRClaimParser
        parser = FHIRClaimParser()
        # Extract the Claim resource directly
        claim_resource = raw_fhir_bundle["entry"][0]["resource"]
        headers = {"X-HCX-Correlation-ID": "test"}
        parsed = parser.parse(claim_resource, headers)
        assert parsed.claim_id == sample_claim.claim_id


# ─────────────────────────────────────────────────────────────────────────────
# PHI Redactor Tests (SEC-005)
# ─────────────────────────────────────────────────────────────────────────────

class TestPHIRedactor:

    def test_national_id_redacted(self):
        from src.utils.phi_redactor import PHIRedactor
        redactor = PHIRedactor()
        result = redactor.redact("Patient ID: 29901011234567 admitted")
        assert "29901011234567" not in result
        assert "[REDACTED-NID]" in result

    def test_phone_number_redacted(self):
        from src.utils.phi_redactor import PHIRedactor
        redactor = PHIRedactor()
        result = redactor.redact("Contact: 01001234567 for follow-up")
        assert "01001234567" not in result
        assert "[REDACTED-PHONE]" in result

    def test_claim_id_hash_is_not_reversible(self):
        from src.utils.phi_redactor import PHIRedactor
        redactor = PHIRedactor()
        h1 = redactor.hash_claim_id("CLAIM-001")
        h2 = redactor.hash_claim_id("CLAIM-001")
        h3 = redactor.hash_claim_id("CLAIM-002")
        assert h1 == h2           # Deterministic
        assert h1 != h3           # Different inputs → different hashes
        assert len(h1) == 16      # Fixed length
