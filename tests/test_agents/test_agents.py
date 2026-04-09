"""
Unit tests for AI agents (SRS Section 9 — pytest + pytest-cov, target 80%).
Uses mocked external dependencies — no live services required.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.fraud_detection import FEATURE_NAMES, FraudDetectionAgent
from src.agents.medical_coding import MedicalCodingAgent
from src.models.schemas import AgentStatus, RiskLevel


# ─────────────────────────────────────────────────────────────────────────────
# Fraud Detection Agent Tests
# ─────────────────────────────────────────────────────────────────────────────

def _mock_redis_noop():
    mock = AsyncMock()
    mock.get.return_value = None
    mock.setex.return_value = True
    mock.publish.return_value = 1
    mock.delete.return_value = 1

    # .client attribute returns another AsyncMock for raw calls
    raw_client = AsyncMock()
    raw_client.lrange = AsyncMock(return_value=[])
    raw_client.sadd = AsyncMock(return_value=1)
    raw_client.expire = AsyncMock(return_value=True)
    raw_client.smembers = AsyncMock(return_value=set())
    mock.client = raw_client
    return mock


def _patch_dedup_db_noop():
    """Replace Postgres dedup lookup with a no-op context manager chain."""
    return patch(
        "src.agents.fraud_detection.create_engine_and_session",
        side_effect=RuntimeError("no db"),
    )


class TestFraudDetectionAgent:

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    @patch("src.agents.fraud_detection.LLMService")
    async def test_low_value_claim_scores_low_risk(
        self, mock_llm_cls, mock_redis_cls, sample_claim
    ):
        mock_redis_cls.return_value = _mock_redis_noop()
        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(return_value="stub explanation")
        mock_llm_cls.return_value = mock_llm

        with _patch_dedup_db_noop(), \
             patch("src.agents.fraud_detection.AuditService.record", AsyncMock()):
            agent = FraudDetectionAgent()
            result = await agent.score(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        assert result.fraud_score is not None
        assert result.fraud_score < 0.45
        assert result.risk_level == RiskLevel.LOW
        assert result.refer_to_siu is False
        # Per-detector anomaly flags should be populated (iforest/lof/hbos)
        detectors = {f["detector"] for f in result.anomaly_flags}
        assert {"iforest", "lof", "hbos"}.issubset(detectors)

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    @patch("src.agents.fraud_detection.LLMService")
    async def test_high_value_outpatient_flags_billing_pattern(
        self, mock_llm_cls, mock_redis_cls, high_value_suspicious_claim
    ):
        mock_redis_cls.return_value = _mock_redis_noop()
        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(return_value="Explanation: high amount, late submission.")
        mock_llm_cls.return_value = mock_llm

        with _patch_dedup_db_noop(), \
             patch("src.agents.fraud_detection.AuditService.record", AsyncMock()):
            agent = FraudDetectionAgent()
            result = await agent.score(high_value_suspicious_claim)

        assert result.status == AgentStatus.COMPLETED
        flags = [f.lower() for f in result.billing_pattern_flags]
        assert any("unusually high" in f for f in flags)
        assert any("late claim" in f for f in flags)
        assert any("documentation" in f for f in flags)
        assert any("excessive" in f for f in flags)

    @pytest.mark.asyncio
    @patch("src.agents.fraud_detection.RedisService")
    @patch("src.agents.fraud_detection.LLMService")
    async def test_high_provider_score_triggers_network_indicator(
        self, mock_llm_cls, mock_redis_cls, sample_claim
    ):
        mock_llm = MagicMock()
        mock_llm.complete = AsyncMock(return_value="stub explanation")
        mock_llm_cls.return_value = mock_llm
        mock_redis = _mock_redis_noop()
        provider_data = json.dumps(
            {
                # High rolling score + high volume — triggers two network indicators
                "rolling_fraud_score": 0.82,
                "claim_count": 750,
                "score_sum": 615.0,
            }
        )

        async def _get(key):
            return provider_data if "provider_score" in key else None

        mock_redis.get.side_effect = _get
        mock_redis_cls.return_value = mock_redis

        with _patch_dedup_db_noop(), \
             patch("src.agents.fraud_detection.AuditService.record", AsyncMock()):
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
        # FR-FD-004: at least 15 features
        assert features.shape[1] >= 15
        assert len(FEATURE_NAMES) >= 15
        assert features[0, 0] == sample_claim.total_amount


# ─────────────────────────────────────────────────────────────────────────────
# Medical Coding Agent Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestMedicalCodingAgent:

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    @patch("src.agents.medical_coding.NDPService")
    async def test_valid_icd10_format_accepted(
        self, mock_ndp_cls, mock_llm_cls, sample_claim
    ):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = json.dumps(
            {
                "icd10_validations": [
                    {"code": "J06.9", "valid": True, "description": "URI", "confidence": 0.98},
                    {"code": "Z00.00", "valid": True, "description": "Exam", "confidence": 0.97},
                ],
                "procedure_validations": [],
                "suggested_corrections": [],
            }
        )
        mock_llm_cls.return_value = mock_llm
        mock_ndp_cls.return_value = AsyncMock()

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        assert result.all_codes_valid is True
        assert len(result.icd10_validations) == 2
        assert result.confidence_score > 0.9

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    @patch("src.agents.medical_coding.NDPService")
    async def test_invalid_icd10_format_flagged(
        self, mock_ndp_cls, mock_llm_cls, sample_claim
    ):
        sample_claim.diagnosis_codes = ["INVALID", "J06.9"]
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = json.dumps(
            {
                "icd10_validations": [
                    {"code": "INVALID", "valid": False, "confidence": 0.1},
                    {"code": "J06.9", "valid": True, "confidence": 0.98},
                ],
                "procedure_validations": [],
                "suggested_corrections": [
                    {"original": "INVALID", "suggested": None, "reason": "Bad format"}
                ],
            }
        )
        mock_llm_cls.return_value = mock_llm
        mock_ndp_cls.return_value = AsyncMock()

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert result.status == AgentStatus.COMPLETED
        invalid_entry = next(v for v in result.icd10_validations if v["code"] == "INVALID")
        assert invalid_entry["format_valid"] is False

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    @patch("src.agents.medical_coding.NDPService")
    async def test_arabic_entities_extracted_from_notes(
        self, mock_ndp_cls, mock_llm_cls, sample_claim
    ):
        arabic_response = json.dumps(
            {"entities": ["ارتفاع في درجة الحرارة", "ألم في الحلق"]}
        )
        coding_response = json.dumps(
            {
                "icd10_validations": [
                    {"code": c, "valid": True, "confidence": 0.95}
                    for c in sample_claim.diagnosis_codes
                ],
                "procedure_validations": [],
                "suggested_corrections": [],
            }
        )
        mock_llm = AsyncMock()
        mock_llm.complete.side_effect = [arabic_response, coding_response]
        mock_llm_cls.return_value = mock_llm
        mock_ndp_cls.return_value = AsyncMock()

        agent = MedicalCodingAgent()
        result = await agent.validate(sample_claim)

        assert len(result.arabic_entities_extracted) == 2
        assert "ارتفاع في درجة الحرارة" in result.arabic_entities_extracted

    @pytest.mark.asyncio
    @patch("src.agents.medical_coding.LLMService")
    @patch("src.agents.medical_coding.NDPService")
    async def test_ndp_unprescribed_fails_pharmacy_claim(
        self, mock_ndp_cls, mock_llm_cls, pharmacy_claim
    ):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = json.dumps(
            {
                "icd10_validations": [
                    {"code": "E11.9", "valid": True, "confidence": 0.97}
                ],
                "procedure_validations": [],
                "suggested_corrections": [],
            }
        )
        mock_llm_cls.return_value = mock_llm

        mock_ndp = AsyncMock()
        mock_ndp.check_prescription.return_value = {
            "prescribed": ["EDA-METFORMIN-500"],
            "dispensed": [],
            "unprescribed": ["EDA-GLIPIZIDE-5"],
            "prescription_matched": "RX-EG-2026-001",
        }
        mock_ndp_cls.return_value = mock_ndp

        agent = MedicalCodingAgent()
        result = await agent.validate(pharmacy_claim)

        assert result.all_codes_valid is False
        assert result.ndp_prescription_check is not None
        assert "EDA-GLIPIZIDE-5" in result.ndp_prescription_check["unprescribed"]


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
        from src.utils.fhir_parser import FHIRClaimParser
        parser = FHIRClaimParser()
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
        assert h1 == h2
        assert h1 != h3
        assert len(h1) == 16

    def test_nested_dict_redacted(self):
        from src.utils.phi_redactor import PHIRedactor
        redactor = PHIRedactor()
        value = {
            "claim": {
                "notes": "Contact 01001234567",
                "patient_name": "Mohamed Ali",
                "codes": ["J06.9", "29901011234567"],
            }
        }
        out = redactor.redact_value(None, value)
        assert out["claim"]["patient_name"] == "[REDACTED]"
        assert "[REDACTED-PHONE]" in out["claim"]["notes"]
        assert "[REDACTED-NID]" in out["claim"]["codes"]

    def test_arabic_indic_digits_redacted(self):
        from src.utils.phi_redactor import PHIRedactor
        redactor = PHIRedactor()
        arabic_id = "٢٩٩٠١٠١١٢٣٤٥٦٧"   # 14 Arabic-Indic digits
        out = redactor.redact(f"المعرف: {arabic_id}")
        assert "[REDACTED-NID]" in out


# ─────────────────────────────────────────────────────────────────────────────
# Schema validator tests — FR-EV-002 (Egyptian NID)
# ─────────────────────────────────────────────────────────────────────────────

class TestNIDValidator:
    def test_valid_14_digit_id(self):
        from src.models.schemas import EligibilityVerifyRequest, ClaimType
        from datetime import datetime, timezone
        req = EligibilityVerifyRequest(
            patient_id="29901011234567",
            payer_id="MISR-001",
            provider_id="HCP-001",
            service_date=datetime.now(timezone.utc),
            claim_type=ClaimType.OUTPATIENT,
        )
        assert req.patient_id == "29901011234567"

    def test_invalid_id_rejected(self):
        import pytest
        from src.models.schemas import EligibilityVerifyRequest, ClaimType
        from datetime import datetime, timezone
        with pytest.raises(Exception):
            EligibilityVerifyRequest(
                patient_id="12",
                payer_id="MISR-001",
                provider_id="HCP-001",
                service_date=datetime.now(timezone.utc),
                claim_type=ClaimType.OUTPATIENT,
            )

    def test_arabic_indic_nid_normalized(self):
        from src.models.schemas import EligibilityVerifyRequest, ClaimType
        from datetime import datetime, timezone
        req = EligibilityVerifyRequest(
            patient_id="٢٩٩٠١٠١١٢٣٤٥٦٧",
            payer_id="MISR-001",
            provider_id="HCP-001",
            service_date=datetime.now(timezone.utc),
            claim_type=ClaimType.OUTPATIENT,
        )
        assert req.patient_id == "29901011234567"
