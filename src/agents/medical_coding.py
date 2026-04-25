"""
Medical Coding Validation Agent (SRS 4.3)

Validates ICD-10 diagnosis codes and procedure codes against:
  - Fine-tuned Llama 8B (ICD-10 validation, 97% exact match) via LiteLLM -> Ollama
  - Arabic-capable LLM (Qwen3 8B / BiMediX replacement) for clinical NER on Arabic notes
  - AraBERT / CAMeL Tools for Arabic medical NER (SRS 2.2)
  - spaCy / medspaCy for English clinical NER (Spark NLP replacement)
  - NDP (National Drug Platform) -- FR-MC-003 pharmacy prescription cross-reference
  - HAPI FHIR terminology server -- SRS 2.3 authoritative ICD-10 validation

Tools: LiteLLM (MIT), NDP internal REST API, HAPI FHIR Server,
       CAMeL Tools / AraBERT (MIT), spaCy / medspaCy (Apache 2.0)
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
from src.services.arabic_nlp_service import ArabicMedicalNLPService
from src.services.code_search_service import CodeSearchService
from src.services.hapi_fhir_service import HAPIFHIRService
from src.services.healthcare_nlp_service import HealthcareNLPService
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
    2. AraBERT / CAMeL Tools Arabic NER extraction (SRS 2.2)
    3. spaCy / medspaCy English clinical NER (Spark NLP replacement)
    4. LLM semantic validation (fine-tuned Llama 8B via LiteLLM -> Ollama)
    5. Cross-check: does extracted clinical text support the submitted codes?
    6. HAPI FHIR terminology server authoritative check (SRS 2.3)
    7. NDP cross-reference for pharmacy claims (FR-MC-003)
    """

    def __init__(self) -> None:
        self._llm = LLMService()
        self._ndp = NDPService()
        self._hapi = HAPIFHIRService()
        self._arabic_nlp = ArabicMedicalNLPService()
        self._healthcare_nlp = HealthcareNLPService()
        self._code_search = CodeSearchService.get_instance()

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

        # 1. Structural validation + deterministic ICD-10 lookup
        #    Uses the authoritative CDC FY2026 ICD-10-CM code set
        #    (74,719 codes) to ground descriptions instead of relying
        #    on LLM-generated descriptions which hallucinate.
        for code in claim.diagnosis_codes:
            format_valid = bool(ICD10_PATTERN.match(code.upper()))
            # Deterministic lookup: exact match in the 74K code table
            lookup = self._code_search.search(
                code, code_type="icd10", limit=1
            )
            found_in_table = (
                len(lookup) > 0
                and lookup[0]["code"].upper() == code.upper()
            )
            authoritative_desc = (
                lookup[0]["description"] if found_in_table else None
            )
            icd10_validations.append(
                {
                    "code": code,
                    "format_valid": format_valid,
                    "semantic_valid": found_in_table if format_valid else False,
                    "description": authoritative_desc,
                    "source": "icd10cm-2026" if found_in_table else None,
                }
            )

        # 2. Arabic NER (if clinical notes present)
        #    Uses AraBERT/CAMeL Tools (SRS 2.2) + LLM fallback via Qwen3
        arabic_nlp_result: dict[str, Any] = {}
        if claim.clinical_notes and settings.enable_arabic_nlp:
            arabic_nlp_result = await self._arabic_nlp.extract_medical_entities(
                claim.clinical_notes,
                use_llm=True,
                llm_service=self._llm,
            )
            arabic_entities = arabic_nlp_result.get("entities", [])
            log.debug(
                "arabic_ner_complete",
                entities_count=len(arabic_entities),
                backend=arabic_nlp_result.get("backend", "unknown"),
                claim_id=claim.claim_id,
            )

        # 2b. English clinical NER (Spark NLP replacement -- SRS 2.2)
        #     Uses spaCy/medspaCy for clinical entity extraction + ICD-10 suggestion
        healthcare_nlp_result: dict[str, Any] = {}
        if claim.clinical_notes:
            healthcare_nlp_result = await self._healthcare_nlp.extract_clinical_entities(
                claim.clinical_notes
            )
            nlp_icd10 = healthcare_nlp_result.get("suggested_icd10", [])
            if nlp_icd10:
                log.debug(
                    "healthcare_nlp_icd10_suggestions",
                    count=len(nlp_icd10),
                    backend=healthcare_nlp_result.get("backend", "unknown"),
                    claim_id=claim.claim_id,
                )

        # 3. LLM semantic validation (Llama 8B via coding-model alias)
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
                        # Only update semantic_valid from LLM if the
                        # deterministic table didn't already resolve it.
                        if v["semantic_valid"] is None:
                            v["semantic_valid"] = item.get("valid")
                        # NEVER overwrite authoritative descriptions
                        # with LLM-generated ones (hallucination fix).
                        if v["description"] is None:
                            v["description"] = item.get("description")
                        v["confidence"] = item.get("confidence")
            procedure_validations = llm_result.get("procedure_validations", [])
            suggested_corrections = llm_result.get("suggested_corrections", [])

        # 3b. SRS 2.3 -- HAPI FHIR terminology server authoritative check.
        # We upgrade semantic confidence when HAPI confirms, and flag codes
        # that the LLM thought valid but HAPI rejects as a correction.
        if claim.diagnosis_codes and settings.hapi_fhir_enabled:
            hapi_results = await self._hapi.validate_icd10_batch(
                claim.diagnosis_codes
            )
            for v in icd10_validations:
                hapi = hapi_results.get(v["code"])
                if hapi is None or hapi.get("skipped"):
                    continue
                v["hapi_valid"] = hapi.get("valid")
                if hapi.get("display"):
                    v["description"] = v.get("description") or hapi["display"]
                # Disagreement: LLM said valid but HAPI rejected.
                if v.get("semantic_valid") is True and hapi.get("valid") is False:
                    v["semantic_valid"] = False
                    suggested_corrections.append(
                        {
                            "original": v["code"],
                            "suggested": None,
                            "reason": (
                                "Not present in HAPI FHIR terminology server "
                                "(ICD-10 CodeSystem)"
                            ),
                            "source": "hapi_fhir",
                        }
                    )

        # 4. Aggregate decision
        #    A code is valid only if BOTH format and semantic checks
        #    pass. Codes where semantic_valid is still None (not
        #    resolved by the deterministic table, HAPI, or LLM) are
        #    treated as INVALID to avoid false-positive approvals.
        format_ok = all(v["format_valid"] for v in icd10_validations)
        semantic_ok = all(
            v.get("semantic_valid") is True for v in icd10_validations
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
                        "reason": "Drugs already dispensed -- possible double-fill",
                        "dispensed": dispensed,
                    }
                )

        all_valid = format_ok and semantic_ok

        # Aggregate confidence (average of per-code confidences)
        confidences = [
            v.get("confidence") for v in icd10_validations if v.get("confidence")
        ]
        # Default to 0.5 (inconclusive) instead of 0.85 when no
        # per-code confidence scores are available.
        avg_confidence = (
            sum(confidences) / len(confidences) if confidences else 0.5
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
            arabic_nlp_backend=arabic_nlp_result.get("backend"),
            healthcare_nlp_backend=healthcare_nlp_result.get("backend"),
            healthcare_nlp_entities=healthcare_nlp_result.get("entities", []),
            suggested_icd10_from_nlp=healthcare_nlp_result.get("suggested_icd10", []),
        )

    async def _extract_arabic_entities(  # noqa: E501
        self, clinical_notes: str,
    ) -> list[str]:
        ar_sys = (
            "أنت نظام استخراج"
            " كيانات طبية."
            " استخرج الأمراض"
            " والأدوية"
            " والإجراءات"
            " الطبية من النص"
            " التالي.\n"
        )
        ar_fmt = (
            '\u0623\u0631\u062c\u0639 JSON \u0641\u0642\u0637'
            ' \u0645\u0639 \u0642\u0627\u0626\u0645\u0629'
            ' "entities"'
            " تحتوي على"
            " الكيانات"
            " المستخرجة"
            " باللغة"
            " العربية.\n\n"
        )
        ar_ex = (
            '{"entities": ["\u0627\u0631\u062a\u0641\u0627\u0639'
            ' \u0636\u063a\u0637 \u0627\u0644\u062f\u0645",'
            ' "\u0627\u0644\u0623\u0633\u0628\u0631\u064a\u0646"]}'
        )
        prompt = (
            f"{ar_sys}{ar_fmt}"
            f"النص: {clinical_notes[:500]}\n\n"
            f"{ar_ex}"
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
