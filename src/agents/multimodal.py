"""
Multimodal Document Analysis Agent (SRS §2.2 — MedGemma 4B Multimodal).

Claims can arrive with attached medical records, prescriptions, and
lab reports referenced through FHIR Claim.supportingInfo. The agent:

1. Fetches each attachment from MinIO using the object IDs already
   extracted by FHIRClaimParser into claim.attachment_ids.
2. Sends the binary to MedGemma 4B Multimodal (via LiteLLM, which
   transparently routes the file to the Ollama-hosted vision model).
3. Parses the model's JSON response into structured findings that the
   coordinator can feed into the necessity assessment.

This is a scaffold — the multimodal LLM endpoint is available only
when `settings.multimodal_enabled` is true and a multimodal model is
configured in litellm_config.yaml. Until then the agent returns an
"disabled" status and the coordinator simply skips it. All metrics,
audit hooks, and API surface are wired up now so enabling it later is
a config-only change.

SRS §2.2 target models:
    - MedGemma 4B Multimodal (Google HAI-DEF, 8GB VRAM)
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.models.schemas import FHIRClaimBundle
from src.services.llm_service import LLMService
from src.utils.metrics import MULTIMODAL_DOCUMENTS_PROCESSED

log = structlog.get_logger(__name__)
settings = get_settings()


@dataclass
class MultimodalAnalysisResult:
    """
    Pure data bag — not a pydantic schema because multimodal runs as
    an optional enrichment that plugs into the necessity agent's
    supporting_evidence, not as a top-level claim state field.
    """
    enabled: bool
    processed: int = 0
    skipped: int = 0
    failed: int = 0
    findings: list[dict[str, Any]] = field(default_factory=list)
    error_message: str | None = None


class MultimodalDocumentAgent:
    """
    Analyzes attached documents via MedGemma 4B Multimodal.
    """

    _shared_minio_client: httpx.AsyncClient | None = None

    def __init__(self) -> None:
        self._llm = LLMService()

    @classmethod
    def _get_minio_client(cls) -> httpx.AsyncClient:
        if cls._shared_minio_client is None:
            scheme = "https" if settings.minio_secure else "http"
            cls._shared_minio_client = httpx.AsyncClient(
                base_url=f"{scheme}://{settings.minio_endpoint}",
                timeout=10.0,
            )
        return cls._shared_minio_client

    @classmethod
    async def close_shared(cls) -> None:
        if cls._shared_minio_client is not None:
            await cls._shared_minio_client.aclose()
            cls._shared_minio_client = None

    async def analyze(self, claim: FHIRClaimBundle) -> MultimodalAnalysisResult:
        if not settings.multimodal_enabled:
            return MultimodalAnalysisResult(enabled=False)
        if not claim.attachment_ids:
            return MultimodalAnalysisResult(enabled=True, skipped=0)

        findings: list[dict[str, Any]] = []
        processed = failed = skipped = 0

        for attachment_id in claim.attachment_ids[:10]:  # cap per claim
            try:
                blob = await self._fetch_attachment(attachment_id)
            except Exception as exc:
                log.warning(
                    "multimodal_fetch_failed",
                    attachment=attachment_id,
                    error=str(exc),
                )
                failed += 1
                MULTIMODAL_DOCUMENTS_PROCESSED.labels(outcome="error").inc()
                continue

            if blob is None:
                skipped += 1
                MULTIMODAL_DOCUMENTS_PROCESSED.labels(outcome="skipped").inc()
                continue

            try:
                finding = await self._analyze_one(blob, claim)
                findings.append(
                    {"attachment_id": attachment_id, **finding}
                )
                processed += 1
                MULTIMODAL_DOCUMENTS_PROCESSED.labels(outcome="ok").inc()
            except Exception as exc:
                log.warning(
                    "multimodal_analysis_failed",
                    attachment=attachment_id,
                    error=str(exc),
                )
                failed += 1
                MULTIMODAL_DOCUMENTS_PROCESSED.labels(outcome="error").inc()

        return MultimodalAnalysisResult(
            enabled=True,
            processed=processed,
            skipped=skipped,
            failed=failed,
            findings=findings,
        )

    async def _fetch_attachment(
        self, attachment_id: str
    ) -> bytes | None:
        """
        Fetch an attachment from MinIO. Supports two on-disk layouts:
          - /<bucket>/<object_id>        (default)
          - /<object_id>                 (legacy — bucket elided)
        """
        client = self._get_minio_client()
        bucket = settings.minio_bucket_documents
        paths = (f"/{bucket}/{attachment_id}", f"/{attachment_id}")
        for path in paths:
            try:
                response = await client.get(path)
                if response.status_code == 200:
                    return response.content
            except httpx.HTTPError:
                continue
        return None

    async def _analyze_one(
        self, blob: bytes, claim: FHIRClaimBundle
    ) -> dict[str, Any]:
        """
        Send one document to MedGemma 4B Multimodal via LiteLLM.
        LiteLLM accepts image/pdf payloads encoded as a data URL in the
        content array per the OpenAI vision schema.
        """
        b64 = base64.b64encode(blob).decode("ascii")
        # The LLMService.complete helper currently targets text-only
        # completions; we reach into the proxy via a direct POST so we
        # can send the vision content array without changing LLMService.
        payload = {
            "model": settings.multimodal_model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a medical record summarizer. Extract key "
                        "findings, medications, and diagnoses from the "
                        "attached document. Return strict JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"Claim type: {claim.claim_type.value}. "
                                "Summarise the attached document as JSON "
                                'with keys "summary", "diagnoses" (list of '
                                'ICD-10 strings), "medications" (list of '
                                'EDA/drug codes), and "notes" (list).'
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:application/octet-stream;base64,{b64}",
                            },
                        },
                    ],
                },
            ],
            "max_tokens": 700,
            "temperature": 0.1,
        }

        # ISSUE-053: Use public complete_vision() instead of private _get_shared_client()
        content = await self._llm.complete_vision(
            messages=payload["messages"],
            model=settings.multimodal_model,
            max_tokens=700,
            temperature=0.1,
        )
        try:
            # ISSUE-017: Use proper prefix/suffix removal
            clean = content.strip()
            if clean.startswith("```json"):
                clean = clean[len("```json"):]
            elif clean.startswith("```"):
                clean = clean[3:]
            if clean.endswith("```"):
                clean = clean[:-3]
            clean = clean.strip()
            parsed = json.loads(clean)
        except (json.JSONDecodeError, AttributeError):
            parsed = {"summary": content, "diagnoses": [], "medications": [], "notes": []}

        # Normalize shape.
        parsed.setdefault("summary", "")
        parsed.setdefault("diagnoses", [])
        parsed.setdefault("medications", [])
        parsed.setdefault("notes", [])
        return parsed
