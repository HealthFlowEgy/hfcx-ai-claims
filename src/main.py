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
from src.api.routes.bff import router as bff_router
from src.api.routes.coordinator import router as coordinator_router
from src.api.routes.documents import router as documents_router
from src.api.routes.feedback import router as feedback_router
from src.api.routes.health import router as health_router
from src.api.routes.llm import router as llm_router
from src.api.routes.memory import router as memory_router
from src.api.routes.sse import router as sse_router
from src.config import get_settings
from src.models.orm import dispose_engine
from src.services.audit_service import AuditService
from src.services.chromadb_seeder import seed_chromadb_if_empty
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
    # Seed ChromaDB clinical guidelines if collections are empty.
    try:
        await seed_chromadb_if_empty()
    except Exception as exc:  # pragma: no cover
        log.warning("chromadb_seed_failed", error=str(exc))
    # FEAT-06: Warm up LiteLLM shared httpx connection pool so the first
    # request is not slow.  We only instantiate the service (which creates
    # the shared httpx.AsyncClient) — we do NOT make an outbound call
    # because external services may be unreachable in CI / dev.
    try:
        LLMService()  # triggers _get_shared_client() classmethod
        log.info("litellm_warmup_ok")
    except Exception as exc:  # pragma: no cover
        log.warning("litellm_warmup_failed", error=str(exc))
    yield
    # Shutdown: stop audit flusher first so pending audit rows drain, then
    # close shared HTTP clients, engine, redis pool, coordinator.
    # Each call is wrapped individually so a single failure (e.g. event loop
    # already closed in TestClient) does not prevent the remaining cleanup.
    _shutdown_tasks = [
        ("audit", AuditService.stop),
        ("coordinator", shutdown_coordinator),
        ("llm", LLMService.close_shared),
        ("eligibility", EligibilityAgent.close_shared),
        ("ndp", NDPService.close_shared),
        ("hapi_fhir", HAPIFHIRService.close_shared),
        ("multimodal", MultimodalDocumentAgent.close_shared),
        ("redis", close_redis_pool),
        ("db_engine", dispose_engine),
    ]
    for name, coro_fn in _shutdown_tasks:
        try:
            await coro_fn()
        except RuntimeError as exc:
            # Tolerate "Event loop is closed" which happens when
            # FastAPI TestClient tears down the ASGI lifespan.
            if "Event loop is closed" not in str(exc):
                raise
            log.debug("shutdown_skipped", component=name, reason=str(exc))
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
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
    app.include_router(bff_router, prefix="/internal/ai", tags=["BFF"])
    app.include_router(health_router, prefix="/internal/ai", tags=["Health"])
    app.include_router(sse_router, prefix="/internal/ai", tags=["SSE"])
    app.include_router(documents_router, prefix="/internal/ai", tags=["Documents"])

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
