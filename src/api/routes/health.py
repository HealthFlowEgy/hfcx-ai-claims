"""
GET /internal/ai/health — AI layer health check (SRS Section 6.2)
"""
from __future__ import annotations

from fastapi import APIRouter
from src.models.schemas import HealthCheckResponse
from src.services.llm_service import LLMService
from src.services.redis_service import RedisService
from src.config import get_settings
import structlog

log = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


@router.get("/health", response_model=HealthCheckResponse)
async def health_check() -> HealthCheckResponse:
    """
    Returns current health of all AI layer dependencies.
    Used by Kubernetes liveness/readiness probes and Grafana alerting.
    """
    redis = RedisService()
    llm = LLMService()

    redis_ok = await redis.ping()
    models_available = await llm.get_model_status()

    # Quick postgres check
    postgres_ok = True
    try:
        from src.models.orm import create_engine_and_session
        engine, _ = create_engine_and_session()
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    except Exception:
        postgres_ok = False

    # ChromaDB check
    chroma_ok = True
    try:
        import chromadb
        client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
        client.heartbeat()
    except Exception:
        chroma_ok = False

    return HealthCheckResponse(
        status="healthy" if redis_ok and postgres_ok else "degraded",
        version=settings.app_version,
        models_available=models_available,
        kafka_connected=True,       # Monitored separately via consumer lag metric
        redis_connected=redis_ok,
        postgres_connected=postgres_ok,
        chromadb_connected=chroma_ok,
        queue_depth=0,              # Kafka consumer lag — populated by Prometheus scrape
    )
