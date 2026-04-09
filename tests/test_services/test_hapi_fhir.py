"""
Tests for HAPIFHIRService (SRS §2.3 terminology validation).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.services.hapi_fhir_service import (
    ICD10_SYSTEM,
    HAPIFHIRService,
)


def _parameters_response(valid: bool, display: str | None = None) -> dict:
    params: list[dict] = [{"name": "result", "valueBoolean": valid}]
    if display:
        params.append({"name": "display", "valueString": display})
    return {"resourceType": "Parameters", "parameter": params}


@pytest.mark.asyncio
@patch("src.services.hapi_fhir_service.settings.hapi_fhir_enabled", True, create=False)
async def test_validate_code_happy_path(monkeypatch):
    monkeypatch.setattr(
        "src.services.hapi_fhir_service.settings.hapi_fhir_enabled",
        True,
        raising=False,
    )

    # Reset circuit breaker in case other tests left it open.
    from src.services.hapi_fhir_service import HAPI_BREAKER
    await HAPI_BREAKER.reset()

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock(return_value=None)
    mock_response.json = MagicMock(
        return_value=_parameters_response(True, "Acute upper respiratory infection")
    )
    client = MagicMock()
    client.get = AsyncMock(return_value=mock_response)

    # Stub Redis to simulate a cache miss + allow setex.
    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value=None)
    fake_redis.setex = AsyncMock(return_value=True)
    with patch(
        "src.services.hapi_fhir_service.RedisService",
        return_value=fake_redis,
    ):
        svc = HAPIFHIRService(client=client)
        out = await svc.validate_code("J06.9", ICD10_SYSTEM)

    assert out["valid"] is True
    assert out["display"] == "Acute upper respiratory infection"
    assert out["cache_hit"] is False
    client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_validate_code_returns_cached(monkeypatch):
    import json

    monkeypatch.setattr(
        "src.services.hapi_fhir_service.settings.hapi_fhir_enabled",
        True,
        raising=False,
    )

    from src.services.hapi_fhir_service import HAPI_BREAKER
    await HAPI_BREAKER.reset()

    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(
        return_value=json.dumps({"valid": True, "display": "X"})
    )
    client = MagicMock()
    client.get = AsyncMock()

    with patch(
        "src.services.hapi_fhir_service.RedisService",
        return_value=fake_redis,
    ):
        svc = HAPIFHIRService(client=client)
        out = await svc.validate_code("E11.9", ICD10_SYSTEM)

    assert out["valid"] is True
    assert out["cache_hit"] is True
    client.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_validate_code_skipped_when_disabled(monkeypatch):
    monkeypatch.setattr(
        "src.services.hapi_fhir_service.settings.hapi_fhir_enabled",
        False,
        raising=False,
    )
    svc = HAPIFHIRService(client=MagicMock())
    out = await svc.validate_code("J06.9", ICD10_SYSTEM)
    assert out["valid"] is True
    assert out.get("skipped") is True


@pytest.mark.asyncio
async def test_validate_code_fails_open_on_error(monkeypatch):
    monkeypatch.setattr(
        "src.services.hapi_fhir_service.settings.hapi_fhir_enabled",
        True,
        raising=False,
    )

    from src.services.hapi_fhir_service import HAPI_BREAKER
    await HAPI_BREAKER.reset()

    client = MagicMock()
    client.get = AsyncMock(side_effect=httpx.ConnectError("down"))

    fake_redis = AsyncMock()
    fake_redis.get = AsyncMock(return_value=None)
    fake_redis.setex = AsyncMock(return_value=True)

    with patch(
        "src.services.hapi_fhir_service.RedisService",
        return_value=fake_redis,
    ):
        svc = HAPIFHIRService(client=client)
        out = await svc.validate_code("J06.9", ICD10_SYSTEM)

    # Fail-open: terminology server errors never hard-deny a claim.
    assert out["valid"] is True
    assert "error" in out


@pytest.mark.asyncio
async def test_batch_icd10(monkeypatch):
    monkeypatch.setattr(
        "src.services.hapi_fhir_service.settings.hapi_fhir_enabled",
        False,
        raising=False,
    )
    svc = HAPIFHIRService(client=MagicMock())
    out = await svc.validate_icd10_batch(["J06.9", "E11.9"])
    assert set(out.keys()) == {"J06.9", "E11.9"}
    assert all(v.get("skipped") for v in out.values())
