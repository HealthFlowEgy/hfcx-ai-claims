"""
LLM Service — LiteLLM proxy client (SRS 2.1, NFR-005)

Provides model-agnostic LLM completions via LiteLLM gateway.
Supports:
  - Hot model swapping without agent code changes (blue-green model routing)
  - Ollama (local GPU) and vLLM (high-throughput) backends
  - Automatic retry with exponential backoff (tenacity)
  - pybreaker circuit breaker shared across agents (FR-AO-004)
  - Per-model latency tracking via Prometheus
"""
from __future__ import annotations

import httpx
import structlog
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from src.config import get_settings
from src.services.circuit_breaker import LLM_BREAKER, call_async_breaker
from src.utils.metrics import MODEL_INFERENCE_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()

# Aliased logical name used in litellm_config.yaml for blue-green routing.
# NFR-005: agents should pass this alias instead of a concrete model tag so
# weighted routing between v1/v2 takes effect without code changes.
COORDINATOR_MODEL_ALIAS = "coordinator-model"


class LLMService:
    """
    Thin async wrapper over LiteLLM proxy REST API.
    All agents call this service — never call Ollama/vLLM directly.

    LiteLLM handles:
    - Model routing (ollama/medgemma:27b → GPU node, ollama/qwen3:7b → CPU node)
    - Load balancing across multiple Ollama instances
    - Blue-green model updates (NFR-005) via the coordinator-model alias
    - Cost tracking per model
    """

    _shared_client: httpx.AsyncClient | None = None

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or self._get_shared_client()

    @classmethod
    def _get_shared_client(cls) -> httpx.AsyncClient:
        if cls._shared_client is None:
            cls._shared_client = httpx.AsyncClient(
                base_url=str(settings.litellm_base_url),
                timeout=settings.litellm_timeout_seconds,
                headers={
                    "Authorization": f"Bearer {settings.litellm_api_key}",
                    "Content-Type": "application/json",
                },
            )
        return cls._shared_client

    @classmethod
    async def close_shared(cls) -> None:
        if cls._shared_client is not None:
            await cls._shared_client.aclose()
            cls._shared_client = None

    async def complete(
        self,
        prompt: str,
        model: str | None = None,
        max_tokens: int = 1000,
        temperature: float = 0.1,
        system_prompt: str | None = None,
    ) -> str:
        """
        Single-turn completion via LiteLLM OpenAI-compatible endpoint.
        Returns the text content of the first choice.
        """
        target_model = model or COORDINATOR_MODEL_ALIAS
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": target_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        async def _do_call() -> str:
            with MODEL_INFERENCE_LATENCY.labels(model=target_model).time():
                response = await self._client.post(
                    "/v1/chat/completions", json=payload
                )
                response.raise_for_status()
                data = response.json()
                content: str = data["choices"][0]["message"]["content"]
                log.debug(
                    "llm_complete",
                    model=target_model,
                    prompt_tokens=data.get("usage", {}).get("prompt_tokens"),
                    completion_tokens=data.get("usage", {}).get("completion_tokens"),
                )
                return content

        # Retry + circuit breaker
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(settings.litellm_max_retries),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception_type(
                (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError)
            ),
            reraise=True,
        ):
            with attempt:
                return await call_async_breaker(LLM_BREAKER, _do_call)
        raise RuntimeError("unreachable")  # pragma: no cover

    async def embed(
        self, texts: list[str], model: str = "ollama/nomic-embed-text"
    ) -> list[list[float]]:
        """Generate embeddings for ChromaDB ingestion."""
        payload = {"model": model, "input": texts}

        async def _do_call() -> list[list[float]]:
            response = await self._client.post("/v1/embeddings", json=payload)
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]

        return await call_async_breaker(LLM_BREAKER, _do_call)

    async def get_model_status(self) -> dict[str, bool]:
        """Check which models are available on the LiteLLM gateway."""
        try:
            response = await self._client.get("/v1/models", timeout=5.0)
            response.raise_for_status()
            data = response.json()
            model_ids = {m["id"] for m in data.get("data", [])}
            return {
                "coordinator": COORDINATOR_MODEL_ALIAS in model_ids
                or settings.litellm_coordinator_model in model_ids,
                "coding": settings.litellm_coding_model in model_ids,
                "arabic": settings.litellm_arabic_model in model_ids,
                "fast": settings.litellm_fast_model in model_ids,
            }
        except Exception as exc:
            log.warning("model_status_check_failed", error=str(exc))
            return {
                "coordinator": False,
                "coding": False,
                "arabic": False,
                "fast": False,
            }

    async def close(self) -> None:
        # Kept for backward-compat; shared client is closed from lifespan.
        pass
