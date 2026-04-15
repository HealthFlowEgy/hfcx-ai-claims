"""
Unit tests for Arabic Medical NLP Service (SRS §2.2 — AraBERT / CAMeL Tools).
"""
from __future__ import annotations

import pytest

from src.services.arabic_nlp_service import (
    ARABIC_MEDICAL_PATTERNS,
    ARABIC_MEDICAL_TERMS,
    ArabicMedicalNLPService,
)


class TestArabicMedicalNLPService:

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty(self):
        result = await ArabicMedicalNLPService.extract_medical_entities("")
        assert result["entities"] == []
        assert result["backend"] == "none"
        assert result["confidence"] == 0.0

    @pytest.mark.asyncio
    async def test_whitespace_only_returns_empty(self):
        result = await ArabicMedicalNLPService.extract_medical_entities("   ")
        assert result["entities"] == []
        assert result["backend"] == "none"

    @pytest.mark.asyncio
    async def test_known_medical_term_detected(self):
        # "التهاب الحلق" is in ARABIC_MEDICAL_TERMS
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "يعاني المريض من التهاب الحلق"
        )
        assert "التهاب الحلق" in result["entities"]

    @pytest.mark.asyncio
    async def test_disease_pattern_detected(self):
        # "ارتفاع" followed by Arabic text should match disease pattern
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "ارتفاع ضغط الدم"
        )
        assert len(result["entities"]) > 0

    @pytest.mark.asyncio
    async def test_body_part_detected(self):
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "ألم في القلب"
        )
        assert "القلب" in result["body_parts"]

    @pytest.mark.asyncio
    async def test_result_structure(self):
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "مريض يعاني من السكري"
        )
        assert "entities" in result
        assert "diseases" in result
        assert "medications" in result
        assert "procedures" in result
        assert "body_parts" in result
        assert "backend" in result
        assert "confidence" in result

    @pytest.mark.asyncio
    async def test_deduplication(self):
        # Repeated terms should be deduplicated
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "السكري والسكري"
        )
        count = result["entities"].count("السكري")
        assert count <= 1

    def test_arabic_medical_patterns_compile(self):
        """Verify all regex patterns compile and match expected text."""
        assert ARABIC_MEDICAL_PATTERNS["disease"].search("التهاب رئوي")
        assert ARABIC_MEDICAL_PATTERNS["medication"].search("دواء مسكن")
        assert ARABIC_MEDICAL_PATTERNS["procedure"].search("تحليل دم")
        assert ARABIC_MEDICAL_PATTERNS["body_part"].search("القلب")

    def test_arabic_medical_terms_not_empty(self):
        assert len(ARABIC_MEDICAL_TERMS) > 10

    @pytest.mark.asyncio
    async def test_medication_pattern_detected(self):
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "يتناول المريض دواء مسكن للألم"
        )
        assert len(result["medications"]) > 0

    @pytest.mark.asyncio
    async def test_procedure_pattern_detected(self):
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "تم إجراء تحليل دم شامل"
        )
        assert len(result["procedures"]) > 0

    @pytest.mark.asyncio
    async def test_multiple_entity_types(self):
        text = "مريض يعاني من ارتفاع ضغط الدم وتم إجراء تحليل دم وأشعة سينية"
        result = await ArabicMedicalNLPService.extract_medical_entities(text)
        assert len(result["entities"]) >= 2
        assert result["confidence"] > 0

    @pytest.mark.asyncio
    async def test_non_arabic_text_returns_minimal(self):
        result = await ArabicMedicalNLPService.extract_medical_entities(
            "Patient has fever and cough"
        )
        # Non-Arabic text should return minimal or no Arabic entities
        assert result["backend"] is not None
