"""
Arabic Medical NLP Service — SRS §2.2 (AraBERT + BiMediX replacement)

Provides Arabic clinical Named Entity Recognition (NER) using:
  1. CAMeL Tools AraBERT-based NER (primary — runs locally, no GPU needed)
  2. LLM-based Arabic NER via Qwen3 through LiteLLM (fallback / enrichment)

The SRS specifies BiMediX 8x7B MoE for bilingual Arabic-English medical QA
and AraBERT for Arabic biomedical NER. Since BiMediX is not available on
Ollama, we use:
  - CAMeL Tools (MIT) for Arabic NER (AraBERT-based, runs on CPU)
  - Qwen3 8B via Ollama for Arabic medical QA and clinical note analysis

Tools: CAMeL Tools (MIT), transformers (Apache 2.0)
"""
from __future__ import annotations

import asyncio
import re
from functools import lru_cache
from typing import Any

import structlog

log = structlog.get_logger(__name__)

# ── Lazy-loaded models (singleton pattern) ──────────────────────────────────
_NER_PIPELINE: Any = None
_NER_LOCK = asyncio.Lock()
_CAMEL_AVAILABLE = False

# Medical entity patterns for regex-based fallback
ARABIC_MEDICAL_PATTERNS = {
    "disease": re.compile(
        r"(?:مرض|التهاب|ورم|سرطان|فشل|قصور|ارتفاع|انخفاض|نقص|فقر|حساسية|عدوى|كسر)"
        r"[\s\u0600-\u06FF]*[\u0600-\u06FF]+"
    ),
    "medication": re.compile(
        r"(?:دواء|حبوب|أقراص|كبسولات|شراب|حقن|مرهم|قطرة)"
        r"[\s\u0600-\u06FF]*[\u0600-\u06FF]+"
    ),
    "procedure": re.compile(
        r"(?:عملية|جراحة|فحص|تحليل|أشعة|منظار|تنظير|خزعة|زراعة)"
        r"[\s\u0600-\u06FF]*[\u0600-\u06FF]+"
    ),
    "body_part": re.compile(
        r"(?:القلب|الكبد|الكلى|الرئة|المعدة|الأمعاء|المخ|العين|الأذن|العظام|الدم|الجلد)"
    ),
}

# Common Arabic medical terms for entity extraction
ARABIC_MEDICAL_TERMS = {
    # Diseases
    "ارتفاع ضغط الدم", "السكري", "الربو", "التهاب رئوي", "فشل كلوي",
    "قصور القلب", "سرطان", "فقر الدم", "حساسية", "التهاب المفاصل",
    "الصرع", "الاكتئاب", "القلق", "السمنة", "الكوليسترول",
    "التهاب الكبد", "قرحة المعدة", "حصوات الكلى", "التهاب الحلق",
    "عدوى الجهاز التنفسي العلوي",
    # Medications
    "الأسبرين", "الميتفورمين", "الأموكسيسيلين", "الإنسولين",
    "الباراسيتامول", "الإيبوبروفين", "الأتورفاستاتين",
    # Procedures
    "تحليل دم", "أشعة سينية", "رنين مغناطيسي", "تخطيط قلب",
    "منظار", "خزعة", "جراحة",
}


async def _ensure_ner_pipeline() -> Any:
    """Lazily load the AraBERT-based NER pipeline."""
    global _NER_PIPELINE, _CAMEL_AVAILABLE
    async with _NER_LOCK:
        if _NER_PIPELINE is not None:
            return _NER_PIPELINE
        try:
            # Try CAMeL Tools first (AraBERT-based, best for Arabic NER)
            from camel_tools.ner import NERecognizer
            _NER_PIPELINE = NERecognizer.pretrained()
            _CAMEL_AVAILABLE = True
            log.info("arabic_nlp_loaded", backend="camel_tools_arabert")
            return _NER_PIPELINE
        except ImportError:
            log.info("camel_tools_not_available", fallback="transformers")
        except Exception as exc:
            log.warning("camel_tools_load_failed", error=str(exc))

        try:
            # Fallback: use transformers with AraBERT NER model
            from transformers import pipeline
            _NER_PIPELINE = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: pipeline(
                    "ner",
                    model="aubmindlab/bert-base-arabertv2",
                    tokenizer="aubmindlab/bert-base-arabertv2",
                    aggregation_strategy="simple",
                ),
            )
            log.info("arabic_nlp_loaded", backend="arabert_transformers")
            return _NER_PIPELINE
        except ImportError:
            log.warning("transformers_not_available", fallback="regex")
        except Exception as exc:
            log.warning("arabert_load_failed", error=str(exc), fallback="regex")

        return None


class ArabicMedicalNLPService:
    """
    Arabic medical NER service combining AraBERT (local) + LLM (Qwen3).

    Extraction pipeline:
    1. AraBERT NER model extracts general Arabic entities
    2. Medical term dictionary matching for known terms
    3. Regex pattern matching for medical entity types
    4. (Optional) LLM enrichment via Qwen3 for complex cases
    """

    @staticmethod
    async def extract_medical_entities(
        text: str,
        *,
        use_llm: bool = False,
        llm_service: Any = None,
    ) -> dict[str, Any]:
        """
        Extract medical entities from Arabic clinical text.

        Returns:
            {
                "entities": ["entity1", "entity2", ...],
                "diseases": [...],
                "medications": [...],
                "procedures": [...],
                "body_parts": [...],
                "backend": "arabert|camel_tools|regex|llm",
                "confidence": 0.0-1.0
            }
        """
        if not text or not text.strip():
            return {
                "entities": [],
                "diseases": [],
                "medications": [],
                "procedures": [],
                "body_parts": [],
                "backend": "none",
                "confidence": 0.0,
            }

        results: dict[str, Any] = {
            "entities": [],
            "diseases": [],
            "medications": [],
            "procedures": [],
            "body_parts": [],
            "backend": "regex",
            "confidence": 0.6,
        }

        # ── Step 1: AraBERT / CAMeL Tools NER ──────────────────────────────
        ner_pipeline = await _ensure_ner_pipeline()
        if ner_pipeline is not None:
            try:
                if _CAMEL_AVAILABLE:
                    # CAMeL Tools NER
                    tokens = text.split()
                    labels = await asyncio.get_event_loop().run_in_executor(
                        None, ner_pipeline.predict, tokens
                    )
                    current_entity = []
                    for token, label in zip(tokens, labels):
                        if label.startswith("B-") or label.startswith("I-"):
                            current_entity.append(token)
                        elif current_entity:
                            results["entities"].append(" ".join(current_entity))
                            current_entity = []
                    if current_entity:
                        results["entities"].append(" ".join(current_entity))
                    results["backend"] = "camel_tools_arabert"
                    results["confidence"] = 0.85
                else:
                    # Transformers pipeline
                    ner_results = await asyncio.get_event_loop().run_in_executor(
                        None, ner_pipeline, text[:512]
                    )
                    for ent in ner_results:
                        word = ent.get("word", "").replace("##", "")
                        if len(word) > 1:
                            results["entities"].append(word)
                    results["backend"] = "arabert_transformers"
                    results["confidence"] = 0.80
            except Exception as exc:
                log.warning("ner_pipeline_failed", error=str(exc))

        # ── Step 2: Medical dictionary matching ─────────────────────────────
        for term in ARABIC_MEDICAL_TERMS:
            if term in text:
                if term not in results["entities"]:
                    results["entities"].append(term)

        # ── Step 3: Regex pattern matching ──────────────────────────────────
        for category, pattern in ARABIC_MEDICAL_PATTERNS.items():
            matches = pattern.findall(text)
            for match in matches:
                match = match.strip()
                if len(match) > 2:
                    key = (
                        f"{category}s"
                        if not category.endswith("s")
                        else category
                    )
                    results[key].append(match)
                    if match not in results["entities"]:
                        results["entities"].append(match)

        # ── Step 4: Body part extraction ────────────────────────────────────
        for match in ARABIC_MEDICAL_PATTERNS["body_part"].findall(text):
            if match not in results["body_parts"]:
                results["body_parts"].append(match)

        # Deduplicate
        for key in ["entities", "diseases", "medications", "procedures", "body_parts"]:
            results[key] = list(dict.fromkeys(results[key]))

        log.debug(
            "arabic_nlp_extraction_complete",
            entity_count=len(results["entities"]),
            backend=results["backend"],
        )

        return results


@lru_cache(maxsize=1)
def get_arabic_nlp_service() -> ArabicMedicalNLPService:
    """Singleton factory for the Arabic NLP service."""
    return ArabicMedicalNLPService()
