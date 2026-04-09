"""
FastAPI Application — Internal AI Intelligence Layer APIs (SRS Section 6.2)

All endpoints are internal-only (not exposed through HFCX API Gateway).
Authentication: Keycloak service-to-service JWT (SEC-001).

Endpoints:
  POST /internal/ai/coordinate
  POST /internal/ai/agents/eligibility/verify
  POST /internal/ai/agents/coding/validate
  POST /internal/ai/agents/fraud/score
  POST /internal/ai/agents/necessity/assess
  POST /internal/ai/memory/store
  GET  /internal/ai/memory/context/{agent}
  POST /internal/ai/llm/completion
  GET  /internal/ai/health
  GET  /internal/ai/metrics
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from prometheus_client import make_asgi_app

from src.agents.coordinator import get_coordinator, shutdown_coordinator
from src.agents.eligibility import EligibilityAgent
from src.agents.multimodal import MultimodalDocumentAgent
from src.api.routes.agents import router as agents_router
from src.api.routes.coordinator import router as coordinator_router
from src.api.routes.feedback import router as feedback_router
from src.api.routes.health import router as health_router
from src.api.routes.llm import router as llm_router
from src.api.routes.memory import router as memory_router
from src.config import get_settings
from src.models.orm import dispose_engine
from src.services.audit_service import AuditService
from src.services.hapi_fhir_service import HAPIFHIRService
from src.services.llm_service import LLMService
from src.services.ndp_service import NDPService
from src.services.redis_service import close_redis_pool
from src.utils.logging import configure_logging
from src.utils.metrics import REQUEST_LATENCY, REQUESTS_TOTAL

log = structlog.get_logger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    log.info(
        "hfcx_ai_starting", version=settings.app_version, env=settings.app_env
    )
    # Start the audit log batcher before anything else writes audit events.
    await AuditService.start()
    # Prime the coordinator graph (async) so the first request is not slow.
    try:
        await get_coordinator().ensure_ready()
    except Exception as exc:  # pragma: no cover — tolerate missing Redis in dev
        log.warning("coordinator_init_failed", error=str(exc))
    yield
    # Shutdown: stop audit flusher first so pending audit rows drain, then
    # close shared HTTP clients, engine, redis pool, coordinator.
    await AuditService.stop()
    await shutdown_coordinator()
    await LLMService.close_shared()
    await EligibilityAgent.close_shared()
    await NDPService.close_shared()
    await HAPIFHIRService.close_shared()
    await MultimodalDocumentAgent.close_shared()
    await close_redis_pool()
    await dispose_engine()
    log.info("hfcx_ai_shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="HFCX AI Claims Intelligence Layer",
        description=(
            "AI-powered claims processing layer for HealthFlow HCX platform. "
            "Internal service — not exposed to external API consumers. "
            "Integrates via Kafka with hcx-pipeline-jobs (Java/Scala)."
        ),
        version=settings.app_version,
        docs_url="/internal/ai/docs" if not settings.is_production else None,
        redoc_url="/internal/ai/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Middleware ────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    # ── Request logging + metrics middleware ──────────────────────────────
    @app.middleware("http")
    async def metrics_middleware(request: Request, call_next):
        t0 = time.monotonic()
        response = await call_next(request)
        duration = time.monotonic() - t0

        REQUEST_LATENCY.labels(
            method=request.method, path=request.url.path
        ).observe(duration)
        REQUESTS_TOTAL.labels(
            method=request.method,
            path=request.url.path,
            status=response.status_code,
        ).inc()

        response.headers["X-HCX-AI-Version"] = settings.app_version
        response.headers["X-Request-Duration-Ms"] = str(int(duration * 1000))
        return response

    # ── Error handler ─────────────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        log.error(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            error=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "ERR-AI-500",
                "message": "Internal AI layer error. Claim routed to manual review.",
                "correlation_id": request.headers.get("X-HCX-Correlation-ID"),
            },
        )

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(coordinator_router, prefix="/internal/ai", tags=["Coordinator"])
    app.include_router(agents_router, prefix="/internal/ai/agents", tags=["Agents"])
    app.include_router(memory_router, prefix="/internal/ai/memory", tags=["Memory"])
    app.include_router(llm_router, prefix="/internal/ai/llm", tags=["LLM"])
    app.include_router(feedback_router, prefix="/internal/ai", tags=["Feedback"])
    app.include_router(health_router, prefix="/internal/ai", tags=["Health"])

    # ── Prometheus metrics endpoint ───────────────────────────────────────
    metrics_app = make_asgi_app()
    app.mount("/internal/ai/metrics", metrics_app)

    # ── OpenTelemetry instrumentation ─────────────────────────────────────
    try:
        FastAPIInstrumentor.instrument_app(app)
    except Exception as exc:  # pragma: no cover — allow tests without OTEL env
        log.warning("otel_fastapi_instrument_failed", error=str(exc))

    return app


app = create_app()
