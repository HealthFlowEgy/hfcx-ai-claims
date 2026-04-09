"""
HAPI FHIR terminology client — SRS §2.3.

Validates ICD-10 and SNOMED codes against a HAPI FHIR R4 terminology
server. Used by the Medical Coding agent as an authoritative source
in addition to the fine-tuned Llama 8B model (FR-MC-001).

Endpoint used: CodeSystem/$validate-code

    GET /fhir/CodeSystem/$validate-code
        ?url=http://hl7.org/fhir/sid/icd-10
        &code=J06.9

Returns a FHIR Parameters resource with a `result` bool. We wrap that
in a tiny 24h Redis cache so repeated validations of the same code
never re-round-trip to HAPI.

Circuit-breaker: protected by CHROMA_BREAKER? No — we give HAPI its
own behaviour. Since HAPI is optional (hapi_fhir_enabled flag) and
usually co-located, a single shared breaker is sufficient — piggyback
on the REGISTRY_BREAKER since it shares similar failure semantics.
Actually we create a dedicated breaker to isolate it cleanly.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.services.circuit_breaker import AsyncCircuitBreaker, call_async_breaker
from src.services.redis_service import RedisService
from src.utils.metrics import HAPI_TERMINOLOGY_LOOKUPS

log = structlog.get_logger(__name__)
settings = get_settings()

# Shared breaker — one per process.
HAPI_BREAKER = AsyncCircuitBreaker(
    name="hapi_fhir",
    fail_max=settings.circuit_breaker_fail_max,
    reset_timeout=float(settings.circuit_breaker_reset_timeout_seconds),
)

# FHIR CodeSystem URLs.
ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10"
SNOMED_SYSTEM = "http://snomed.info/sct"


class HAPIFHIRService:
    """
    Thin client around HAPI's $validate-code operation with a Redis cache.
    """

    CACHE_PREFIX = "hapi_fhir:v1:"
    CACHE_TTL_SECONDS = 86400  # 24h — terminology is slow-moving

    _shared_client: httpx.AsyncClient | None = None

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._redis = RedisService()
        self._client = client or self._get_shared_client()

    @classmethod
    def _get_shared_client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            cls._shared_client = httpx.AsyncClient(
                base_url=settings.hapi_fhir_base_url,
                timeout=settings.hapi_fhir_timeout_seconds,
                headers={"Accept": "application/fhir+json"},
            )
        return cls._shared_client

    @classmethod
    async def close_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    @staticmethod
    def _system_label(system: str) -> str:
        if "icd" in system.lower():
            return "icd10"
        if "snomed" in system.lower():
            return "snomed"
        return "other"

    def _cache_key(self, system: str, code: str) -> str:
        return f"{self.CACHE_PREFIX}{self._system_label(system)}:{code}"

    async def validate_code(
        self,
        code: str,
        system: str = ICD10_SYSTEM,
    ) -> dict[str, Any]:
        """
        Returns ``{"valid": bool, "display": str|None, "cache_hit": bool}``.

        If HAPI is disabled (settings.hapi_fhir_enabled=False) or
        unreachable, the method returns ``{"valid": True}`` so the code
        never hard-denies a claim on terminology-server trouble — the
        LLM validator still runs as the authoritative signal.
        """
        if not settings.hapi_fhir_enabled:
            return {"valid": True, "display": None, "cache_hit": False, "skipped": True}

        system_label = self._system_label(system)
        cache_key = self._cache_key(system, code)

        cached = await self._redis.get(cache_key)
        if cached:
            try:
                data = json.loads(cached)
                data["cache_hit"] = True
                HAPI_TERMINOLOGY_LOOKUPS.labels(
                    system=system_label, outcome="hit"
                ).inc()
                return data
            except (json.JSONDecodeError, TypeError):
                pass

        # Miss — call HAPI.
        async def _do_call() -> httpx.Response:
            return await self._client.get(
                "/CodeSystem/$validate-code",
                params={"url": system, "code": code},
            )

        try:
            response = await call_async_breaker(HAPI_BREAKER, _do_call)
            response.raise_for_status()
            params = response.json()
        except Exception as exc:
            log.warning(
                "hapi_terminology_error",
                code=code,
                system=system_label,
                error=str(exc),
            )
            HAPI_TERMINOLOGY_LOOKUPS.labels(
                system=system_label, outcome="error"
            ).inc()
            # Fail-open — don't block claim on terminology server issues.
            return {"valid": True, "display": None, "cache_hit": False, "error": str(exc)}

        result = _parse_validate_code_response(params)
        HAPI_TERMINOLOGY_LOOKUPS.labels(
            system=system_label,
            outcome="miss" if result["valid"] is False else "hit",
        ).inc()

        # Cache the result (even misses — they're also slow-moving).
        try:
            await self._redis.setex(
                cache_key,
                self.CACHE_TTL_SECONDS,
                json.dumps({"valid": result["valid"], "display": result["display"]}),
            )
        except Exception:
            pass

        return {
            "valid": result["valid"],
            "display": result["display"],
            "cache_hit": False,
        }

    async def validate_icd10_batch(
        self, codes: list[str]
    ) -> dict[str, dict[str, Any]]:
        """Convenience: validate many ICD-10 codes at once."""
        out: dict[str, dict[str, Any]] = {}
        for code in codes:
            out[code] = await self.validate_code(code, ICD10_SYSTEM)
        return out


def _parse_validate_code_response(params: dict[str, Any]) -> dict[str, Any]:
    """
    Pull ``result: bool`` and ``display: str`` out of a FHIR Parameters
    resource returned by ``$validate-code``.
    """
    valid: bool = False
    display: str | None = None
    for p in params.get("parameter", []) or []:
        name = p.get("name")
        if name == "result":
            valid = bool(p.get("valueBoolean", False))
        elif name == "display":
            display = p.get("valueString")
    return {"valid": valid, "display": display}
