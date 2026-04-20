"""
NDP (National Drug Platform) client — FR-MC-003.

The medical coding agent calls this to cross-reference a pharmacy claim
against HealthFlow's existing NDP prescription data, detecting:
  - medications not prescribed to this patient
  - medications already dispensed (preventing double-fills)
"""
from __future__ import annotations

from typing import Any

import httpx
import structlog
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

from src.config import get_settings
from src.services.circuit_breaker import NDP_BREAKER, call_async_breaker

log = structlog.get_logger(__name__)
settings = get_settings()


class NDPService:
    """Thin async REST client for the internal NDP service."""

    _shared_client: httpx.AsyncClient | None = None

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or self._get_shared_client()

    @classmethod
    def _get_shared_client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            cls._shared_client = httpx.AsyncClient(
                base_url=str(settings.ndp_api_url),
                timeout=settings.ndp_timeout_seconds,
                headers={"X-API-Key": settings.ndp_api_key},
            )
        return cls._shared_client

    @classmethod
    async def close_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    async def close(self) -> None:
        # Backwards-compat per-instance close; prefer close_shared() at shutdown.
        pass

    async def check_prescription(
        self,
        *,
        patient_id: str,
        drug_codes: list[str],
        prescription_id: str | None,
    ) -> dict[str, Any]:
        """
        Query NDP for all prescriptions + dispense history for this patient.
        Returns a dict with three lists:
          - prescribed (EDA codes the patient has been prescribed in the last 90d)
          - dispensed  (EDA codes already dispensed — candidates for double-fill)
          - unprescribed (drug codes in this claim not found in any prescription)

        ISSUE-016: Uses AsyncRetrying instead of sync @retry decorator.
        """
        if not drug_codes:
            return {
                "prescribed": [],
                "dispensed": [],
                "unprescribed": [],
                "prescription_matched": None,
            }

        async def _do_call() -> httpx.Response:
            return await self._client.post(
                "/prescriptions/check",
                json={
                    "patient_id": patient_id,
                    "drug_codes": drug_codes,
                    "prescription_id": prescription_id,
                },
            )

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=1, max=4),
                reraise=True,
            ):
                with attempt:
                    response = await call_async_breaker(NDP_BREAKER, _do_call)
                    response.raise_for_status()
                    data: dict[str, Any] = response.json()
        except Exception as exc:
            log.warning("ndp_lookup_failed", error=str(exc))
            return {
                "prescribed": [],
                "dispensed": [],
                "unprescribed": drug_codes,
                "prescription_matched": None,
                "error": str(exc),
            }

        return {
            "prescribed": data.get("prescribed", []),
            "dispensed": data.get("dispensed", []),
            "unprescribed": data.get("unprescribed", []),
            "prescription_matched": data.get("prescription_matched"),
        }
