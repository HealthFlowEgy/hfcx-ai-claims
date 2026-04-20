"""
Healthcare NLP Service — SRS §2.2 (Spark NLP + PyHealth replacement)

The SRS specifies Spark NLP for medical NER and PyHealth for healthcare ML
pipelines. Due to dependency conflicts (PyHealth pins pandas<2, Spark NLP
requires Java), we implement equivalent functionality using:

  1. spaCy + medspaCy (Apache 2.0) — clinical NER, section detection, context
  2. scikit-learn pipelines — healthcare ML (already in the stack)

This service provides:
  - Clinical Named Entity Recognition (diseases, medications, procedures)
  - ICD-10 code suggestion from clinical text
  - Medical abbreviation expansion
  - Negation detection (e.g., "no fever" → fever is negated)

Tools: spaCy (MIT), medspaCy (Apache 2.0)
"""
from __future__ import annotations

import asyncio
import re
from functools import lru_cache
from typing import Any

import structlog

log = structlog.get_logger(__name__)

# ── Lazy-loaded NLP models ──────────────────────────────────────────────────
_MEDSPACY_NLP: Any = None
_MEDSPACY_LOCK = asyncio.Lock()
_SPACY_NLP: Any = None
_SPACY_LOCK = asyncio.Lock()

# Common medical abbreviations (Egyptian healthcare context)
MEDICAL_ABBREVIATIONS = {
    "HTN": "Hypertension",
    "DM": "Diabetes Mellitus",
    "DM2": "Diabetes Mellitus Type 2",
    "COPD": "Chronic Obstructive Pulmonary Disease",
    "CHF": "Congestive Heart Failure",
    "MI": "Myocardial Infarction",
    "CVA": "Cerebrovascular Accident",
    "UTI": "Urinary Tract Infection",
    "URTI": "Upper Respiratory Tract Infection",
    "CKD": "Chronic Kidney Disease",
    "AKI": "Acute Kidney Injury",
    "PE": "Pulmonary Embolism",
    "DVT": "Deep Vein Thrombosis",
    "CAD": "Coronary Artery Disease",
    "GERD": "Gastroesophageal Reflux Disease",
    "PNA": "Pneumonia",
    "SOB": "Shortness of Breath",
    "CP": "Chest Pain",
    "HA": "Headache",
    "N/V": "Nausea/Vomiting",
    "ABX": "Antibiotics",
    "Rx": "Prescription",
    "Dx": "Diagnosis",
    "Hx": "History",
    "Sx": "Symptoms",
    "Tx": "Treatment",
    "Fx": "Fracture",
}

# ICD-10 keyword to code mapping (common Egyptian healthcare codes)
ICD10_KEYWORD_MAP = {
    "hypertension": "I10",
    "diabetes": "E11.9",
    "diabetes mellitus": "E11.9",
    "type 2 diabetes": "E11.9",
    "asthma": "J45.909",
    "pneumonia": "J18.9",
    "upper respiratory infection": "J06.9",
    "urinary tract infection": "N39.0",
    "heart failure": "I50.9",
    "myocardial infarction": "I21.9",
    "stroke": "I63.9",
    "chronic kidney disease": "N18.9",
    "anemia": "D64.9",
    "depression": "F32.9",
    "anxiety": "F41.9",
    "obesity": "E66.9",
    "copd": "J44.1",
    "fracture": "T14.8",
    "headache": "R51",
    "chest pain": "R07.9",
    "abdominal pain": "R10.9",
    "fever": "R50.9",
    "cough": "R05",
    "back pain": "M54.9",
    "joint pain": "M25.50",
    "gastritis": "K29.70",
    "hepatitis": "K75.9",
    "appendicitis": "K35.80",
    "cholecystitis": "K81.9",
    "renal calculus": "N20.0",
    "allergic reaction": "T78.40",
}


async def _ensure_medspacy() -> Any:
    """Lazily load medspaCy pipeline."""
    global _MEDSPACY_NLP
    async with _MEDSPACY_LOCK:
        if _MEDSPACY_NLP is not None:
            return _MEDSPACY_NLP
        try:
            import medspacy
            _MEDSPACY_NLP = await asyncio.get_running_loop().run_in_executor(
                None, medspacy.load
            )
            log.info("healthcare_nlp_loaded", backend="medspacy")
            return _MEDSPACY_NLP
        except ImportError:
            log.info("medspacy_not_available", fallback="spacy")
        except Exception as exc:
            log.warning("medspacy_load_failed", error=str(exc))
        return None


async def _ensure_spacy() -> Any:
    """Lazily load spaCy pipeline as fallback."""
    global _SPACY_NLP
    async with _SPACY_LOCK:
        if _SPACY_NLP is not None:
            return _SPACY_NLP
        try:
            import spacy
            try:
                _SPACY_NLP = await asyncio.get_running_loop().run_in_executor(
                    None, spacy.load, "en_core_web_sm"
                )
            except OSError:
                # Model not downloaded — use blank English model
                _SPACY_NLP = spacy.blank("en")
            log.info("healthcare_nlp_loaded", backend="spacy")
            return _SPACY_NLP
        except ImportError:
            log.warning("spacy_not_available", fallback="regex")
        except Exception as exc:
            log.warning("spacy_load_failed", error=str(exc))
        return None


class HealthcareNLPService:
    """
    Clinical NLP service for English medical text processing.

    Replaces Spark NLP + PyHealth with spaCy/medspaCy equivalents.
    """

    @staticmethod
    async def extract_clinical_entities(text: str) -> dict[str, Any]:
        """
        Extract clinical entities from English medical text.

        Returns:
            {
                "entities": [{"text": "...", "label": "...", "negated": bool}],
                "abbreviations_expanded": {"HTN": "Hypertension", ...},
                "suggested_icd10": [{"code": "I10", "description": "...", "confidence": 0.8}],
                "backend": "medspacy|spacy|regex"
            }
        """
        if not text or not text.strip():
            return {
                "entities": [],
                "abbreviations_expanded": {},
                "suggested_icd10": [],
                "backend": "none",
            }

        results: dict[str, Any] = {
            "entities": [],
            "abbreviations_expanded": {},
            "suggested_icd10": [],
            "backend": "regex",
        }

        # ── Step 1: Expand medical abbreviations ───────────────────────────
        for abbr, expansion in MEDICAL_ABBREVIATIONS.items():
            pattern = re.compile(rf"\b{re.escape(abbr)}\b", re.IGNORECASE)
            if pattern.search(text):
                results["abbreviations_expanded"][abbr] = expansion

        # ── Step 2: medspaCy clinical NER (if available) ───────────────────
        nlp = await _ensure_medspacy()
        if nlp is not None:
            try:
                doc = await asyncio.get_running_loop().run_in_executor(
                    None, nlp, text[:2000]
                )
                for ent in doc.ents:
                    is_negated = False
                    if hasattr(ent, "_.is_negated"):
                        is_negated = ent._.is_negated
                    results["entities"].append({
                        "text": ent.text,
                        "label": ent.label_,
                        "negated": is_negated,
                        "start": ent.start_char,
                        "end": ent.end_char,
                    })
                results["backend"] = "medspacy"
            except Exception as exc:
                log.warning("medspacy_extraction_failed", error=str(exc))
        else:
            # Fallback to basic spaCy
            nlp = await _ensure_spacy()
            if nlp is not None:
                try:
                    doc = await asyncio.get_running_loop().run_in_executor(
                        None, nlp, text[:2000]
                    )
                    for ent in doc.ents:
                        results["entities"].append({
                            "text": ent.text,
                            "label": ent.label_,
                            "negated": False,
                            "start": ent.start_char,
                            "end": ent.end_char,
                        })
                    results["backend"] = "spacy"
                except Exception as exc:
                    log.warning("spacy_extraction_failed", error=str(exc))

        # ── Step 3: ICD-10 suggestion from text keywords ───────────────────
        text_lower = text.lower()
        for keyword, code in ICD10_KEYWORD_MAP.items():
            if keyword in text_lower:
                # Check if negated (simple negation detection)
                negated = False
                for neg_word in ["no ", "not ", "denies ", "without ", "negative for "]:
                    idx = text_lower.find(keyword)
                    if idx > 0:
                        context = text_lower[max(0, idx - 30):idx]
                        if neg_word in context:
                            negated = True
                            break

                if not negated:
                    results["suggested_icd10"].append({
                        "code": code,
                        "description": keyword.title(),
                        "confidence": 0.75,
                        "source": "keyword_match",
                    })

        # Deduplicate ICD-10 suggestions
        seen_codes = set()
        unique_icd10 = []
        for item in results["suggested_icd10"]:
            if item["code"] not in seen_codes:
                seen_codes.add(item["code"])
                unique_icd10.append(item)
        results["suggested_icd10"] = unique_icd10

        log.debug(
            "healthcare_nlp_extraction_complete",
            entity_count=len(results["entities"]),
            icd10_suggestions=len(results["suggested_icd10"]),
            backend=results["backend"],
        )

        return results


@lru_cache(maxsize=1)
def get_healthcare_nlp_service() -> HealthcareNLPService:
    """Singleton factory for the Healthcare NLP service."""
    return HealthcareNLPService()
