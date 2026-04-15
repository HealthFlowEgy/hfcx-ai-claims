"""
Unit tests for Healthcare NLP Service (SRS 2.2 - Spark NLP replacement).
"""
from __future__ import annotations

import pytest

from src.services.healthcare_nlp_service import (
    ICD10_KEYWORD_MAP,
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
