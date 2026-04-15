"""
Unit tests for Healthcare NLP Service (SRS 2.2 - Spark NLP replacement).
"""
from __future__ import annotations

import pytest

from src.services.healthcare_nlp_service import (
    ICD10_KEYWORD_MAP,
    MEDICAL_ABBREVIATIONS,
    HealthcareNLPService,
)


class TestHealthcareNLPService:

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities("")
        assert result["entities"] == []
        assert result["backend"] in ("none", "regex")

    @pytest.mark.asyncio
    async def test_whitespace_only_returns_empty(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities("   ")
        assert result["entities"] == []

    @pytest.mark.asyncio
    async def test_result_structure(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "Patient has hypertension and chest pain"
        )
        assert "entities" in result
        assert "suggested_icd10" in result
        assert "backend" in result

    @pytest.mark.asyncio
    async def test_icd10_suggestion_for_known_term(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities("hypertension")
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        assert "I10" in codes

    def test_clinical_term_mapping_not_empty(self):
        assert len(ICD10_KEYWORD_MAP) > 10

    @pytest.mark.asyncio
    async def test_multiple_conditions_detected(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "Patient with diabetes and hypertension"
        )
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        assert "I10" in codes
        has_diabetes = any(c.startswith("E11") for c in codes)
        assert has_diabetes

    @pytest.mark.asyncio
    async def test_abbreviation_expansion(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "Patient with HTN and DM2 on ABX"
        )
        expanded = result.get("abbreviations_expanded", {})
        assert "HTN" in expanded
        assert expanded["HTN"] == "Hypertension"
        assert "DM2" in expanded

    @pytest.mark.asyncio
    async def test_negation_detection(self):
        svc = HealthcareNLPService()
        # Use a sentence where negated term is clearly separated
        result = await svc.extract_clinical_entities(
            "Patient denies diabetes. No fever reported."
        )
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        # Diabetes should be negated and excluded
        has_diabetes = any(c.startswith("E11") for c in codes)
        assert not has_diabetes
        # Fever should also be negated
        assert "R50.9" not in codes

    @pytest.mark.asyncio
    async def test_icd10_deduplication(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "diabetes mellitus type 2 diabetes"
        )
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        # Should not have duplicate E11.9
        assert codes.count("E11.9") == 1

    def test_medical_abbreviations_not_empty(self):
        assert len(MEDICAL_ABBREVIATIONS) > 20

    @pytest.mark.asyncio
    async def test_chest_pain_detected(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "Patient presents with chest pain"
        )
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        assert "R07.9" in codes

    @pytest.mark.asyncio
    async def test_fever_detected(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities("Patient has fever")
        icd10 = result.get("suggested_icd10", [])
        codes = [s.get("code") for s in icd10]
        assert "R50.9" in codes

    @pytest.mark.asyncio
    async def test_no_false_positive_on_unrelated_text(self):
        svc = HealthcareNLPService()
        result = await svc.extract_clinical_entities(
            "The weather is sunny today"
        )
        icd10 = result.get("suggested_icd10", [])
        assert len(icd10) == 0
