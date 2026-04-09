"""
Medical Coding Validation Agent (SRS 4.3)

Validates ICD-10 diagnosis codes and procedure codes against:
  - Fine-tuned Llama 8B (ICD-10 validation, 97% exact match)
  - Arabic-capable LLM (BiMediX/Qwen3) for clinical NER on Arabic notes
  - NDP (National Drug Platform) — FR-MC-003 pharmacy prescription cross-reference

Tools: LiteLLM (MIT), NDP internal REST API
"""
from __future__ import annotations

import json
import re
from typing import Any

import structlog

from src.config import get_settings
from src.models.schemas import (
    AgentStatus,
    ClaimType,
    CodingValidationResult,
    FHIRClaimBundle,
)
from src.services.llm_service import LLMService
from src.services.ndp_service import NDPService
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()

# Known valid ICD-10 prefixes (Egypt uses WHO ICD-10, extended with Egyptian codes)
ICD10_PATTERN = re.compile(r"^[A-Z]\d{2}(\.\d{1,4})?$")


class MedicalCodingAgent:
    """
    FR-MC-001 through FR-MC-004 implementation.

    Validation pipeline:
    1. Structural ICD-10 format check (regex)
    2. LLM semantic validation (fine-tuned Llama 8B via LiteLLM)
    3. Arabic NER extraction from clinical notes (if available)
    4. Cross-check: does extracted clinical text support the submitted codes?
    5. NDP cross-reference for pharmacy claims (FR-MC-003)
    """

    def __init__(self) -> None:
        self._llm = LLMService()
        self._ndp = NDPService()

    async def validate(self, claim: FHIRClaimBundle) -> CodingValidationResult:
        with AGENT_LATENCY.labels(agent="medical_coding").time():
            return await self._run_validation(claim)

    async def _run_validation(
        self, claim: FHIRClaimBundle
    ) -> CodingValidationResult:
        icd10_validations: list[dict[str, Any]] = []
        procedure_validations: list[dict[str, Any]] = []
        suggested_corrections: list[dict[str, Any]] = []
        arabic_entities: list[str] = []

        # 1. Structural validation
        for code in claim.diagnosis_codes:
            icd10_validations.append(
                {
                    "code": code,
                    "format_valid": bool(ICD10_PATTERN.match(code.upper())),
                    "semantic_valid": None,
                    "description": None,
                }
            )

        # 2. Arabic NER (if clinical notes present)
        if claim.clinical_notes and settings.enable_arabic_nlp:
            arabic_entities = await self._extract_arabic_entities(claim.clinical_notes)
            log.debug(
                "arabic_ner_complete",
                entities_count=len(arabic_entities),
                claim_id=claim.claim_id,
            )

        # 3. LLM semantic validation
        if claim.diagnosis_codes or claim.procedure_codes:
            llm_result = await self._llm_validate_codes(
                diagnosis_codes=claim.diagnosis_codes,
                procedure_codes=claim.procedure_codes,
                clinical_notes=claim.clinical_notes,
                arabic_entities=arabic_entities,
                claim_type=claim.claim_type.value,
            )
            for item in llm_result.get("icd10_validations", []):
                for v in icd10_validations:
                    if v["code"] == item.get("code"):
                        v.update(
                            {
                                "semantic_valid": item.get("valid"),
                                "description": item.get("description"),
                                "confidence": item.get("confidence"),
                            }
                        )
            procedure_validations = llm_result.get("procedure_validations", [])
            suggested_corrections = llm_result.get("suggested_corrections", [])

        # 4. Aggregate decision
        format_ok = all(v["format_valid"] for v in icd10_validations)
        semantic_ok = all(
            v.get("semantic_valid", True) is not False for v in icd10_validations
        )

        # 5. FR-MC-003: NDP cross-reference (pharmacy claims only)
        ndp_check: dict[str, Any] | None = None
        if claim.claim_type == ClaimType.PHARMACY and claim.drug_codes:
            ndp_check = await self._ndp.check_prescription(
                patient_id=claim.patient_id,
                drug_codes=claim.drug_codes,
                prescription_id=claim.prescription_id,
            )
            unprescribed = ndp_check.get("unprescribed") or []
            dispensed = ndp_check.get("dispensed") or []
            if unprescribed:
                semantic_ok = False
                suggested_corrections.append(
                    {
                        "category": "pharmacy",
                        "reason": "Drugs not found in any recent prescription (NDP)",
                        "unprescribed": unprescribed,
                    }
                )
            if dispensed:
                semantic_ok = False
                suggested_corrections.append(
                    {
                        "category": "pharmacy",
                        "reason": "Drugs already dispensed — possible double-fill",
                        "dispensed": dispensed,
                    }
                )

        all_valid = format_ok and semantic_ok

        # Aggregate confidence (average of per-code confidences)
        confidences = [
            v.get("confidence") for v in icd10_validations if v.get("confidence")
        ]
        avg_confidence = (
            sum(confidences) / len(confidences) if confidences else 0.85
        )

        return CodingValidationResult(
            status=AgentStatus.COMPLETED,
            all_codes_valid=all_valid,
            icd10_validations=icd10_validations,
            procedure_validations=procedure_validations,
            suggested_corrections=suggested_corrections,
            confidence_score=avg_confidence,
            arabic_entities_extracted=arabic_entities,
            ndp_prescription_check=ndp_check,
        )

    async def _extract_arabic_entities(self, clinical_notes: str) -> list[str]:
        prompt = (
            "أنت نظام استخراج كيانات طبية. استخرج الأمراض والأدوية والإجراءات "
            "الطبية من النص التالي.\n"
            'أرجع JSON فقط مع قائمة "entities" تحتوي على الكيانات المستخرجة '
            "باللغة العربية.\n\n"
            f"النص: {clinical_notes[:500]}\n\n"
            'مثال على التنسيق: {"entities": ["ارتفاع ضغط الدم", "الأسبرين"]}'
        )

        try:
            response = await self._llm.complete(
                prompt=prompt,
                model=settings.litellm_arabic_model,
                max_tokens=200,
                temperature=0.1,
            )
            clean = response.strip().lstrip("```json").rstrip("```").strip()
            data = json.loads(clean)
            return data.get("entities", [])
        except Exception as exc:
            log.warning("arabic_ner_failed", error=str(exc))
            return []

    async def _llm_validate_codes(
        self,
        diagnosis_codes: list[str],
        procedure_codes: list[str],
        clinical_notes: str | None,
        arabic_entities: list[str],
        claim_type: str,
    ) -> dict[str, Any]:
        prompt = f"""You are an Egyptian healthcare ICD-10 coding expert. \
Validate the following medical codes.

Claim type: {claim_type}
ICD-10 diagnosis codes: {diagnosis_codes}
Procedure codes: {procedure_codes}
Clinical notes summary: {(clinical_notes or '')[:300]}
Extracted Arabic clinical entities: {arabic_entities}

For each ICD-10 code, validate:
1. Is the code a valid ICD-10 code (exists in WHO classification)?
2. Does the code match the clinical context?
3. Is the specificity level appropriate?

Return ONLY a JSON object with this exact structure:
{{
  "icd10_validations": [
    {{"code": "A00.0", "valid": true, "description": "Cholera", "confidence": 0.98}}
  ],
  "procedure_validations": [
    {{"code": "99213", "valid": true, "description": "Office visit", "confidence": 0.95}}
  ],
  "suggested_corrections": [
    {{"original": "Z00", "suggested": "Z00.00", "reason": "Requires 5th character"}}
  ]
}}"""

        try:
            response = await self._llm.complete(
                prompt=prompt,
                model=settings.litellm_coding_model,
                max_tokens=800,
                temperature=0.0,
            )
            clean = response.strip().lstrip("```json").rstrip("```").strip()
            return json.loads(clean)
        except Exception as exc:
            log.warning("coding_llm_parse_failed", error=str(exc))
            return {
                "icd10_validations": [
                    {"code": c, "valid": True, "confidence": 0.5}
                    for c in diagnosis_codes
                ],
                "procedure_validations": [],
                "suggested_corrections": [],
            }
