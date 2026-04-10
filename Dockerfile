# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims Layer — Dockerfile
#
# Uses the pre-built base image (Dockerfile.base) which contains all Python
# dependencies including heavy ML packages (PyTorch, sentence-transformers,
# ChromaDB, XGBoost, etc.). This makes CI builds complete in < 2 minutes.
#
# If the base image is not yet available, fall back to building from scratch
# by setting --build-arg BASE_IMAGE=python:3.11-slim (the install step will
# then run inline — slower but still functional).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Application layer on pre-built base ─────────────────────────────
ARG BASE_IMAGE=registry.digitalocean.com/hfcx-registry/hfcx-ai-claims-base:latest
FROM ${BASE_IMAGE} AS production

LABEL org.opencontainers.image.title="HFCX AI Claims Layer"
LABEL org.opencontainers.image.description="AI-powered claims processing for HealthFlow HCX"
LABEL org.opencontainers.image.vendor="HealthFlow Group"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

# Copy application source code (the only layer that changes per commit)
COPY --chown=hfcx:hfcx src/ ./src/
COPY --chown=hfcx:hfcx pyproject.toml README.md ./

# Install the package itself (no-deps — all dependencies are in the base image)
RUN pip install --no-cache-dir --no-deps -e .

USER hfcx

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8090/internal/ai/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090", \
     "--workers", "4", "--log-level", "info"]

EXPOSE 8090
