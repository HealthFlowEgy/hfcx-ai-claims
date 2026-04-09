"""
Unit tests for verify_service_jwt (SEC-001).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from src.api import middleware as mw


@pytest.mark.asyncio
async def test_dev_bypass_returns_dev_service():
    with patch.object(mw.settings, "app_env", "development"):
        result = await mw.verify_service_jwt(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="anything")
        )
    assert result == "dev-service"


@pytest.mark.asyncio
async def test_invalid_jwt_raises_401():
    with patch.object(mw.settings, "app_env", "production"), \
         patch("src.api.middleware._get_jwks", AsyncMock(return_value={"keys": []})), \
         patch("src.api.middleware.jwt.decode", side_effect=mw.JWTError("bad")):
        with pytest.raises(HTTPException) as exc_info:
            await mw.verify_service_jwt(
                HTTPAuthorizationCredentials(scheme="Bearer", credentials="x.y.z")
            )
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_valid_jwt_returns_subject():
    with patch.object(mw.settings, "app_env", "production"), \
         patch("src.api.middleware._get_jwks", AsyncMock(return_value={"keys": []})), \
         patch("src.api.middleware.jwt.decode", return_value={"sub": "svc-account-1"}):
        result = await mw.verify_service_jwt(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="x.y.z")
        )
    assert result == "svc-account-1"
