"""
GET /internal/ai/health — AI layer health check (SRS Section 6.2)
"""
from __future__ import annotations

import socket

import structlog
from fastapi import APIRouter
from sqlalchemy import text

from src.config import get_settings
from src.models.schemas import HealthCheckResponse
from src.services.llm_service import LLMService
from src.services.redis_service import RedisService
from src.utils.metrics import KAFKA_CONSUMER_LAG

log = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


def _kafka_tcp_probe() -> bool:
    """
    Cheap TCP-level probe — confirms that a broker address is reachable.
    The actual AIOKafkaConsumer lag is published as a Prometheus gauge
    (KAFKA_CONSUMER_LAG) from the consumer process.
    """
    bootstrap = settings.kafka_bootstrap_servers.split(",")[0]
    host, _, port = bootstrap.partition(":")
    try:
        with socket.create_connection((host, int(port or 9092)), timeout=2.0):
            return True
    except Exception:
        return False


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

    # Postgres probe
    postgres_ok = True
    try:
        from src.models.orm import create_engine_and_session

        engine, _ = create_engine_and_session()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        postgres_ok = False

    # ChromaDB probe
    chroma_ok = True
    try:
        import chromadb

        client = chromadb.HttpClient(
            host=settings.chroma_host, port=settings.chroma_port
        )
        client.heartbeat()
    except Exception:
        chroma_ok = False

    # Kafka: TCP probe + lag gauge
    kafka_ok = _kafka_tcp_probe()
    try:
        queue_depth = int(KAFKA_CONSUMER_LAG._value.get())  # type: ignore[attr-defined]
    except Exception:
        queue_depth = 0

    status = (
        "healthy"
        if all([redis_ok, postgres_ok, chroma_ok, kafka_ok])
        else "degraded"
    )

    return HealthCheckResponse(
        status=status,
        version=settings.app_version,
        models_available=models_available,
        kafka_connected=kafka_ok,
        redis_connected=redis_ok,
        postgres_connected=postgres_ok,
        chromadb_connected=chroma_ok,
        queue_depth=queue_depth,
    )
