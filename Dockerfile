# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims Layer — Dockerfile
# Multi-stage build for minimal production image
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build dependencies ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# System deps for native extensions (numpy, cryptography, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir build wheel && \
    pip install --no-cache-dir -e ".[dev]" --target /deps

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="HFCX AI Claims Layer"
LABEL org.opencontainers.image.description="AI-powered claims processing for HealthFlow HCX"
LABEL org.opencontainers.image.vendor="HealthFlow Group"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

# Runtime system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN useradd -m -u 1001 -s /bin/bash hfcx
USER hfcx

# Copy installed packages from builder
COPY --from=builder --chown=hfcx:hfcx /deps /home/hfcx/.local/lib/python3.11/site-packages

# Copy application source
COPY --chown=hfcx:hfcx src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8090/internal/ai/health || exit 1

# Default: API server. Override for consumer: python -m src.kafka.consumer
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090", \
     "--workers", "4", "--log-level", "info"]

EXPOSE 8090
