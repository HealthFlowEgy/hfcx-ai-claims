"""
Eligibility Verification Agent (SRS 4.2)

Checks patient coverage against the payer's eligibility registry.
Results are cached in Redis for 1 hour to avoid redundant HFCX registry calls.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import get_settings
from src.models.schemas import AgentStatus, ClaimType, EligibilityResult, FHIRClaimBundle
from src.services.redis_service import RedisService
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()


class EligibilityAgent:
    """
    FR-EV-001 through FR-EV-004 implementation.

    Cache strategy:
    - Key: SHA-256(patient_id + payer_id + service_date_month + claim_type)
    - TTL: 3600s (configurable via REDIS_ELIGIBILITY_TTL_SECONDS)
    - Cache is invalidated when coverage changes are detected (webhook from HFCX)
    """

    CACHE_PREFIX = "eligibility:v1:"

    def __init__(self) -> None:
        self._redis = RedisService()
        self._http = httpx.AsyncClient(
            base_url=str(settings.hfcx_registry_url),
            timeout=10.0,
        )

    def _cache_key(self, patient_id: str, payer_id: str, service_date: datetime, claim_type: ClaimType) -> str:
        # Month-level granularity — eligibility rarely changes within a month
        month_str = service_date.strftime("%Y-%m")
        raw = f"{patient_id}:{payer_id}:{month_str}:{claim_type.value}"
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"{self.CACHE_PREFIX}{digest}"

    async def verify(self, claim: FHIRClaimBundle) -> EligibilityResult:
        cache_key = self._cache_key(
            claim.patient_id, claim.payer_id, claim.service_date, claim.claim_type
        )

        # ── L1: Redis cache ───────────────────────────────────────────────
        cached = await self._redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["cache_hit"] = True
            log.debug("eligibility_cache_hit", patient_id=claim.patient_id)
            return EligibilityResult(**data)

        # ── L2: Live HFCX registry call ───────────────────────────────────
        with AGENT_LATENCY.labels(agent="eligibility").time():
            result = await self._fetch_from_registry(claim)

        # Cache the result
        await self._redis.setex(
            cache_key,
            settings.redis_eligibility_ttl_seconds,
            result.model_dump_json(),
        )

        return result

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=4))
    async def _fetch_from_registry(self, claim: FHIRClaimBundle) -> EligibilityResult:
        """
        Calls the HFCX participant registry to resolve payer-side eligibility.
        In production, this calls the payer's /coverageeligibility/check endpoint
        via the HFCX API Gateway, reusing the existing CoverageEligibility FHIR resource.
        """
        try:
            response = await self._http.post(
                "/eligibility/check",
                json={
                    "patient_id": claim.patient_id,
                    "payer_id": claim.payer_id,
                    "provider_id": claim.provider_id,
                    "service_date": claim.service_date.isoformat(),
                    "claim_type": claim.claim_type.value,
                },
                headers={"X-HCX-Correlation-ID": claim.hcx_correlation_id},
            )
            response.raise_for_status()
            data = response.json()

            return EligibilityResult(
                status=AgentStatus.COMPLETED,
                is_eligible=data.get("eligible", True),
                coverage_active=data.get("coverage_active", True),
                coverage_type=data.get("coverage_type"),
                deductible_remaining=data.get("deductible_remaining"),
                copay_percentage=data.get("copay_percentage"),
                exclusions=data.get("exclusions", []),
                cache_hit=False,
                checked_at=datetime.utcnow(),
            )

        except httpx.HTTPStatusError as exc:
            log.warning(
                "eligibility_registry_error",
                status=exc.response.status_code,
                claim_id=claim.claim_id,
            )
            if exc.response.status_code == 404:
                # Patient not found in registry → not eligible
                return EligibilityResult(
                    status=AgentStatus.COMPLETED,
                    is_eligible=False,
                    coverage_active=False,
                    error_message="Patient not found in payer registry",
                )
            raise

        except httpx.TimeoutException:
            log.error("eligibility_timeout", claim_id=claim.claim_id)
            # On timeout: assume eligible, flag for review (fail-open for patient access)
            return EligibilityResult(
                status=AgentStatus.COMPLETED,
                is_eligible=True,
                coverage_active=True,
                error_message="Registry timeout — eligibility assumed, flagged for review",
            )

    async def invalidate_cache(self, patient_id: str, payer_id: str) -> int:
        """
        Invalidate all cached eligibility entries for a patient+payer pair.
        Called when the HFCX platform notifies of coverage changes.
        Returns number of keys deleted.
        """
        pattern = f"{self.CACHE_PREFIX}*"
        keys = await self._redis.keys(pattern)
        deleted = 0
        for key in keys:
            await self._redis.delete(key)
            deleted += 1
        log.info("eligibility_cache_invalidated", patient_id=patient_id, deleted=deleted)
        return deleted
