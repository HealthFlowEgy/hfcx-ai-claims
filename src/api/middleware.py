"""
Service-to-Service JWT Authentication (SEC-001)
Validates Keycloak service account tokens on all internal AI API endpoints.
"""
from __future__ import annotations

import httpx
import structlog
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from src.config import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()
_bearer = HTTPBearer()

# Cached JWKS from Keycloak (refreshed on 401)
_jwks_cache: dict | None = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            url = (
                f"{settings.keycloak_url}/realms/{settings.keycloak_realm}"
                "/protocol/openid-connect/certs"
            )
            resp = await client.get(url, timeout=5.0)
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def verify_service_jwt(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> str:
    """
    FastAPI dependency — verifies service JWT issued by Keycloak.
    Returns the client_id (subject) of the verified token.
    """
    # In development, skip verification
    if settings.app_env == "development":
        return "dev-service"

    token = credentials.credentials
    try:
        jwks = await _get_jwks()
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=settings.keycloak_client_id,
            options={"verify_exp": True},
        )
        subject = payload.get("sub", "unknown")
        log.debug("jwt_verified", subject=subject)
        return subject
    except JWTError as exc:
        global _jwks_cache
        _jwks_cache = None  # Force JWKS refresh on next call
        log.warning("jwt_verification_failed", error=str(exc))
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired service token",
            headers={"WWW-Authenticate": "Bearer"},
        )
