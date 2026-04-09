"""
Unit test for the Kafka consumer's FHIR extension builder (SRS 3.4 / 5.1).

The consumer constructs a FHIR ClaimResponse.extension[] payload from the
AI analysis — this test verifies all required extension URLs are present,
without touching the actual Kafka clients.
"""
from __future__ import annotations

from src.kafka.consumer import ClaimsKafkaConsumer
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


def _analysis(sample_claim):
    return ClaimAnalysisState(
        claim=sample_claim,
        correlation_id="test-001",
        adjudication_decision=AdjudicationDecision.APPROVED,
        overall_confidence=0.91,
        requires_human_review=False,
        eligibility=EligibilityResult(status=AgentStatus.COMPLETED, is_eligible=True),
        coding=CodingValidationResult(
            status=AgentStatus.COMPLETED, all_codes_valid=True, confidence_score=0.97
        ),
        fraud=FraudDetectionResult(
            status=AgentStatus.COMPLETED,
            fraud_score=0.08,
            risk_level=RiskLevel.LOW,
            explanation="Clean signals across all detectors.",
        ),
        necessity=MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=True,
            arabic_summary="ملخص موجز",
        ),
    )


def test_build_fhir_extensions_includes_all_sections(sample_claim):
    consumer = ClaimsKafkaConsumer()
    extensions = consumer._build_fhir_extensions(_analysis(sample_claim))
    urls = {e["url"] for e in extensions}

    base = "https://healthflow.io/fhir/StructureDefinition/ai-claim"
    for suffix in (
        "-adjudication",
        "-confidence",
        "-fraud-risk",
        "-fraud-score",
        "-fraud-explanation",
        "-coding-valid",
        "-coding-confidence",
        "-eligibility",
        "-requires-review",
        "-necessity-summary-ar",
    ):
        assert f"{base}{suffix}" in urls, f"missing extension {suffix}"
