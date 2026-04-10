# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims Layer — Production Dockerfile
#
# Self-contained multi-stage build. Uses CPU-only PyTorch (~200 MB vs ~2 GB
# CUDA) because AI models run via Ollama / LiteLLM, not directly in Python.
# Dependencies are installed in a separate stage for optimal layer caching.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# System build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip wheel setuptools

# Install CPU-only PyTorch first (prevents sentence-transformers from
# pulling the full CUDA torch ~2 GB)
RUN pip install --target=/deps \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Copy dependency metadata and install all project packages
COPY pyproject.toml README.md ./
RUN mkdir -p src && touch src/__init__.py && \
    pip install --target=/deps . && \
    rm -rf /build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS production

LABEL org.opencontainers.image.title="HFCX AI Claims Layer"
LABEL org.opencontainers.image.description="AI-powered claims processing for HealthFlow HCX"
LABEL org.opencontainers.image.vendor="HealthFlow Group"
LABEL org.opencontainers.image.version="1.0.0"

# Runtime system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1001 -s /bin/bash hfcx

# Copy pre-built dependencies from builder
COPY --from=builder /deps /usr/local/lib/python3.11/site-packages/
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages

WORKDIR /app

# Copy application source (the only layer that changes per commit)
COPY --chown=hfcx:hfcx src/ ./src/
COPY --chown=hfcx:hfcx pyproject.toml README.md ./

# Install the package itself (no-deps — all dependencies already copied)
RUN pip install --no-cache-dir --no-deps -e .

USER hfcx

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8090/internal/ai/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090", \
     "--workers", "4", "--log-level", "info"]

EXPOSE 8090
