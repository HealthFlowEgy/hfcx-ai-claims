# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims Layer — Dockerfile
# Multi-stage build for minimal production image
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build dependencies ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install --upgrade pip wheel build && \
    pip install --prefix=/install .

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="HFCX AI Claims Layer"
LABEL org.opencontainers.image.description="AI-powered claims processing for HealthFlow HCX"
LABEL org.opencontainers.image.vendor="HealthFlow Group"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 -s /bin/bash hfcx

COPY --from=builder /install /usr/local
COPY --chown=hfcx:hfcx src/ ./src/

USER hfcx

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8090/internal/ai/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090", \
     "--workers", "4", "--log-level", "info"]

EXPOSE 8090
