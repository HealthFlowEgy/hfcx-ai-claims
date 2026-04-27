"""
Eligibility Verification Agent (SRS 4.2)

Checks patient coverage against the payer's eligibility registry.
Results are cached in Redis for 24h (FR-EV-001) to avoid redundant
HFCX registry calls.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import get_settings
from src.models.schemas import AgentStatus, ClaimType, EligibilityResult, FHIRClaimBundle
from src.services.circuit_breaker import REGISTRY_BREAKER, call_async_breaker
from src.services.redis_service import RedisService, _await_redis
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()


class EligibilityAgent:
    """
    FR-EV-001 through FR-EV-004 implementation.

    Cache strategy:
    - Key: eligibility:v1:{hash(patient_id + payer_id + service_date_month + claim_type)}
    - Prefix index: eligibility:v1:{patient_id}:{payer_id} → set of cache keys
      (used by invalidate_cache to delete only the matching pair)
    - TTL: 86400s (FR-EV-001, configurable)
    """

    CACHE_PREFIX = "eligibility:v1:"

    _shared_client: httpx.AsyncClient | None = None

    def __init__(self) -> None:
        self._redis = RedisService()
        self._http = self._get_shared_client()

    @classmethod
    def _get_shared_client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            cls._shared_client = httpx.AsyncClient(
                base_url=str(settings.hfcx_registry_url),
                timeout=10.0,
            )
        return cls._shared_client

    @classmethod
    async def close_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    def _cache_key(
        self,
        patient_id: str,
        payer_id: str,
        service_date: datetime,
        claim_type: ClaimType,
    ) -> str:
        month_str = service_date.strftime("%Y-%m")
        raw = f"{patient_id}:{payer_id}:{month_str}:{claim_type.value}"
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"{self.CACHE_PREFIX}{digest}"

    def _index_key(self, patient_id: str, payer_id: str) -> str:
        return f"{self.CACHE_PREFIX}idx:{patient_id}:{payer_id}"

    async def verify(self, claim: FHIRClaimBundle) -> EligibilityResult:
        cache_key = self._cache_key(
            claim.patient_id, claim.payer_id, claim.service_date, claim.claim_type
        )

        # L1: Redis cache — skip degraded results so registry is retried
        cached = await self._redis.get(cache_key)
        if cached:
            try:
                data = json.loads(cached)
                if data.get("error_message"):
                    # Degraded result — don't serve from cache, retry registry
                    log.debug("eligibility_cache_skip_degraded", patient_id=claim.patient_id)
                else:
                    data["cache_hit"] = True
                    log.debug("eligibility_cache_hit", patient_id=claim.patient_id)
                    return EligibilityResult(**data)
            except (json.JSONDecodeError, TypeError):
                pass

        # L2: HFCX registry call
        with AGENT_LATENCY.labels(agent="eligibility").time():
            result = await self._fetch_from_registry(claim)

        # Cache result — use short TTL for degraded results so registry is retried soon
        ttl = 60 if result.error_message else settings.redis_eligibility_ttl_seconds
        await self._redis.setex(
            cache_key,
            ttl,
            result.model_dump_json(),
        )
        # Maintain prefix index so invalidate_cache can find this key later.
        try:
            await _await_redis(self._redis.client.sadd(
                self._index_key(claim.patient_id, claim.payer_id), cache_key
            ))
            await _await_redis(self._redis.client.expire(
                self._index_key(claim.patient_id, claim.payer_id),
                settings.redis_eligibility_ttl_seconds,
            ))
        except Exception:
            pass

        return result

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=4))
    async def _fetch_from_registry(self, claim: FHIRClaimBundle) -> EligibilityResult:
        """
        Calls the HFCX participant registry to resolve payer-side eligibility.
        Protected by the shared REGISTRY_BREAKER so registry outages do not
        cascade into the claim pipeline (NFR-004).
        """
        async def _do_call() -> httpx.Response:
            return await self._http.post(
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

        try:
            response = await call_async_breaker(REGISTRY_BREAKER, _do_call)
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
                checked_at=datetime.now(UTC),
            )

        except httpx.HTTPStatusError as exc:
            log.warning(
                "eligibility_registry_error",
                status=exc.response.status_code,
                claim_id=claim.claim_id,
            )
            if exc.response.status_code == 404:
                return EligibilityResult(
                    status=AgentStatus.COMPLETED,
                    is_eligible=False,
                    coverage_active=False,
                    error_message="Patient not found in payer registry",
                )
            raise

        except (httpx.TimeoutException, Exception) as exc:
            # Fail-open for patient access: assume eligible, flag for review.
            log.error(
                "eligibility_degraded",
                claim_id=claim.claim_id,
                error=str(exc),
            )
            return EligibilityResult(
                status=AgentStatus.COMPLETED,
                is_eligible=True,
                coverage_active=True,
                error_message=(
                    f"Registry unavailable — {exc.__class__.__name__};"
                    " flagged for review"
                ),
            )

    async def invalidate_cache(self, patient_id: str, payer_id: str) -> int:
        """
        Invalidate cached eligibility entries for a specific patient+payer pair.
        Called when the HFCX platform notifies of coverage changes.
        """
        idx = self._index_key(patient_id, payer_id)
        try:
            keys = await _await_redis(self._redis.client.smembers(idx))
        except Exception:
            keys = set()

        deleted = 0
        for key in keys:
            if await self._redis.delete(key):
                deleted += 1
        try:
            await self._redis.delete(idx)
        except Exception:
            pass
        log.info(
            "eligibility_cache_invalidated",
            patient_id=patient_id,
            payer_id=payer_id,
            deleted=deleted,
        )
        return deleted
