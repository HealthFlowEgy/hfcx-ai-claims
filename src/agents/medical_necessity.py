"""
Medical Necessity Agent (SRS 4.5)

Assesses medical necessity using:
  - MedGemma 27B (primary reasoning) via LiteLLM → Ollama, behind the
    coordinator-model LiteLLM alias for NFR-005 blue-green routing
  - ChromaDB RAG over EDA Egyptian Drug Authority formulary (47,292 drug codes)
  - ChromaDB RAG over Egyptian clinical guidelines and NHIA coverage policies
  - BiMediX for Arabic clinical note analysis

Tools: ChromaDB (Apache 2.0), MedGemma (Open HAI-DEF), LiteLLM (MIT)
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import chromadb
import structlog

from src.config import get_settings
from src.models.schemas import (
    AgentStatus,
    FHIRClaimBundle,
    MedicalNecessityResult,
)
from src.services.circuit_breaker import CHROMA_BREAKER, call_async_breaker
from src.services.llm_service import COORDINATOR_MODEL_ALIAS, LLMService
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()


class MedicalNecessityAgent:
    """
    FR-MN-001 through FR-MN-002 implementation.
    """

    _chroma_client: chromadb.api.ClientAPI | None = None

    def __init__(self) -> None:
        self._llm = LLMService()
        # Lazy-init — constructing HttpClient eagerly connects to the server,
        # which breaks unit tests and cold-start in environments where ChromaDB
        # is not yet reachable (NFR-004 graceful degradation).
        self._eda_collection: chromadb.Collection | None = None
        self._guidelines_collection: chromadb.Collection | None = None

    @classmethod
    def _get_shared_chroma(cls) -> chromadb.api.ClientAPI | None:
        if cls._chroma_client is None:
            try:
                cls._chroma_client = chromadb.HttpClient(
                    host=settings.chroma_host,
                    port=settings.chroma_port,
                )
            except Exception as exc:
                log.warning("chroma_client_init_failed", error=str(exc))
                return None
        return cls._chroma_client

    @property
    def _chroma(self) -> chromadb.api.ClientAPI | None:
        return self._get_shared_chroma()

    def _get_eda_collection(self) -> chromadb.Collection | None:
        if self._eda_collection is None:
            client = self._chroma
            if client is None:
                return None
            try:
                self._eda_collection = client.get_or_create_collection(
                    name=settings.chroma_collection_eda_formulary,
                    metadata={"hnsw:space": "cosine"},
                )
            except Exception as exc:
                log.warning("chroma_collection_unavailable", error=str(exc))
                return None
        return self._eda_collection

    def _get_guidelines_collection(self) -> chromadb.Collection | None:
        if self._guidelines_collection is None:
            client = self._chroma
            if client is None:
                return None
            try:
                self._guidelines_collection = client.get_or_create_collection(
                    name=settings.chroma_collection_clinical_guidelines,
                    metadata={"hnsw:space": "cosine"},
                )
            except Exception as exc:
                log.warning("chroma_collection_unavailable", error=str(exc))
                return None
        return self._guidelines_collection

    async def assess(self, claim: FHIRClaimBundle) -> MedicalNecessityResult:
        with AGENT_LATENCY.labels(agent="medical_necessity").time():
            return await self._run_assessment(claim)

    async def _run_assessment(
        self, claim: FHIRClaimBundle
    ) -> MedicalNecessityResult:
        eda_context = await self._retrieve_eda_context(claim)
        guidelines_context = await self._retrieve_guidelines_context(claim)

        formulary_status = await self._check_eda_formulary(
            claim.drug_codes, eda_context
        )

        assessment = await self._llm_assess_necessity(
            claim=claim,
            eda_context=eda_context,
            guidelines_context=guidelines_context,
            formulary_status=formulary_status,
        )

        arabic_summary = None
        if settings.enable_arabic_nlp:
            arabic_summary = await self._generate_arabic_summary(
                claim=claim, assessment=assessment
            )

        return MedicalNecessityResult(
            status=AgentStatus.COMPLETED,
            is_medically_necessary=assessment.get("is_necessary"),
            confidence_score=assessment.get("confidence"),
            supporting_evidence=assessment.get("supporting_evidence", []),
            clinical_guidelines_referenced=assessment.get("guidelines_referenced", []),
            eda_formulary_status=formulary_status,
            alternative_suggestions=assessment.get("alternatives", []),
            arabic_summary=arabic_summary,
        )

    async def _retrieve_eda_context(
        self, claim: FHIRClaimBundle
    ) -> list[dict[str, Any]]:
        collection = self._get_eda_collection()
        if collection is None:
            return []
        query_texts = claim.drug_codes[:5] + claim.diagnosis_codes[:3]
        if not query_texts:
            return []
        return await self._query_collection(collection, query_texts)

    async def _retrieve_guidelines_context(
        self, claim: FHIRClaimBundle
    ) -> list[dict[str, Any]]:
        collection = self._get_guidelines_collection()
        if collection is None:
            return []
        query_texts = claim.diagnosis_codes[:5] + claim.procedure_codes[:3]
        if not query_texts:
            return []
        return await self._query_collection(collection, query_texts)

    async def _query_collection(
        self, collection: chromadb.Collection, query_texts: list[str]
    ) -> list[dict[str, Any]]:
        def _run() -> Any:
            return collection.query(
                query_texts=query_texts,
                n_results=5,
                include=["documents", "metadatas", "distances"],  # type: ignore
            )

        try:
            # ChromaDB client is blocking — offload to thread + circuit breaker.
            async def _run_async():
                return await asyncio.to_thread(_run)

            results = await call_async_breaker(CHROMA_BREAKER, _run_async)
        except Exception as exc:
            log.warning("chroma_query_failed", error=str(exc))
            return []

        docs: list[dict[str, Any]] = []
        docs_list = results.get("documents") or []
        metas_list = results.get("metadatas") or []
        dists_list = results.get("distances") or []
        for i, doc in enumerate(docs_list[0] if docs_list else []):
            docs.append(
                {
                    "content": doc,
                    "metadata": (metas_list[0][i] if metas_list else {}),
                    "relevance": 1.0 - (dists_list[0][i] if dists_list else 0),
                }
            )
        return docs

    async def _check_eda_formulary(
        self, drug_codes: list[str], eda_context: list[dict[str, Any]]
    ) -> str:
        if not drug_codes:
            return "not_applicable"
        for doc in eda_context:
            meta = doc.get("metadata", {}) or {}
            status = meta.get("formulary_status")
            if status in ("listed", "unlisted", "restricted"):
                return status
        return "listed"

    async def _llm_assess_necessity(
        self,
        claim: FHIRClaimBundle,
        eda_context: list[dict[str, Any]],
        guidelines_context: list[dict[str, Any]],
        formulary_status: str,
    ) -> dict[str, Any]:
        eda_text = (
            "\n".join([d["content"][:200] for d in eda_context[:3]])
            or "No EDA data available."
        )
        guidelines_text = (
            "\n".join([d["content"][:200] for d in guidelines_context[:3]])
            or "No guidelines available."
        )

        prompt = f"""You are a senior Egyptian healthcare medical necessity \
reviewer with expertise in NHIA coverage policies and EDA formulary.

CLAIM INFORMATION:
- Claim Type: {claim.claim_type.value}
- Diagnosis Codes (ICD-10): {claim.diagnosis_codes}
- Procedure Codes: {claim.procedure_codes}
- Drug Codes: {claim.drug_codes}
- Total Amount: EGP {claim.total_amount:,.2f}
- EDA Formulary Status: {formulary_status}
- Clinical Notes: {(claim.clinical_notes or 'None provided')[:400]}

RELEVANT EDA FORMULARY CONTEXT:
{eda_text}

RELEVANT CLINICAL GUIDELINES:
{guidelines_text}

ASSESSMENT TASK:
Evaluate whether this claim is medically necessary based on:
1. Clinical appropriateness of procedures for the diagnoses
2. EDA formulary compliance for drugs
3. Egyptian NHIA coverage policies
4. Cost-effectiveness

Return ONLY a JSON object with this structure:
{{
  "is_necessary": true,
  "confidence": 0.92,
  "supporting_evidence": ["..."],
  "guidelines_referenced": ["..."],
  "alternatives": [],
  "concerns": []
}}"""

        try:
            response = await self._llm.complete(
                prompt=prompt,
                model=COORDINATOR_MODEL_ALIAS,     # NFR-005 blue-green routing
                max_tokens=600,
                temperature=0.1,
            )
            clean = response.strip().lstrip("```json").rstrip("```").strip()
            return json.loads(clean)
        except Exception as exc:
            log.warning("necessity_llm_failed", error=str(exc))
            return {
                "is_necessary": True,
                "confidence": 0.5,
                "supporting_evidence": ["Assessment inconclusive — requires human review"],
                "guidelines_referenced": [],
                "alternatives": [],
            }

    async def _generate_arabic_summary(
        self, claim: FHIRClaimBundle, assessment: dict[str, Any]
    ) -> str:
        verdict_ar = (
            "مستوفية للمعايير الطبية"
            if assessment.get("is_necessary")
            else "تحتاج إلى مراجعة طبية"
        )
        confidence = assessment.get("confidence", 0.5)

        prompt = f"""أنت مراجع طبي متخصص. \
اكتب ملخصاً طبياً موجزاً باللغة العربية لهذه المطالبة التأمينية.

نتيجة التقييم: {verdict_ar}
مستوى الثقة: {confidence:.0%}
الأدلة الداعمة: {assessment.get('supporting_evidence', [])}
نوع المطالبة: {claim.claim_type.value}

اكتب ملخصاً بـ 2-3 جمل باللغة العربية فقط، يوضح سبب القرار الطبي."""

        try:
            summary = await self._llm.complete(
                prompt=prompt,
                model=settings.litellm_arabic_model,
                max_tokens=200,
                temperature=0.3,
            )
            return summary.strip()
        except Exception as exc:
            log.warning("arabic_summary_failed", error=str(exc))
            return f"تم تقييم المطالبة بمستوى ثقة {confidence:.0%}. {verdict_ar}."
