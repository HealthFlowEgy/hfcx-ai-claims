"""
LLM Service — LiteLLM proxy client (SRS 2.1, NFR-005)

Provides model-agnostic LLM completions via LiteLLM gateway.
Supports:
  - Hot model swapping without agent code changes (blue-green model routing)
  - Ollama (local GPU) and vLLM (high-throughput) backends
  - Automatic retry with exponential backoff
  - Per-model cost/latency tracking via LiteLLM built-ins
"""
from __future__ import annotations

import asyncio

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from src.config import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()


class LLMService:
    """
    Thin async wrapper over LiteLLM proxy REST API.
    All agents call this service — never call Ollama/vLLM directly.

    LiteLLM handles:
    - Model routing (ollama/medgemma:27b → GPU node, ollama/qwen3:7b → CPU node)
    - Load balancing across multiple Ollama instances
    - Blue-green model updates (NFR-005)
    - Cost tracking per model
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=str(settings.litellm_base_url),
            timeout=settings.litellm_timeout_seconds,
            headers={
                "Authorization": f"Bearer {settings.litellm_api_key}",
                "Content-Type": "application/json",
            },
        )

    @retry(
        stop=stop_after_attempt(settings.litellm_max_retries if hasattr(settings, 'litellm_max_retries') else 3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
    )
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
        target_model = model or settings.litellm_coordinator_model
        messages = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": target_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        try:
            response = await self._client.post("/v1/chat/completions", json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]

            log.debug(
                "llm_complete",
                model=target_model,
                prompt_tokens=data.get("usage", {}).get("prompt_tokens"),
                completion_tokens=data.get("usage", {}).get("completion_tokens"),
            )
            return content

        except httpx.HTTPStatusError as exc:
            log.error(
                "llm_http_error",
                status=exc.response.status_code,
                model=target_model,
                response_text=exc.response.text[:200],
            )
            raise

    async def embed(self, texts: list[str], model: str = "ollama/nomic-embed-text") -> list[list[float]]:
        """
        Generate embeddings for ChromaDB ingestion.
        Uses nomic-embed-text (best open-source embedding model as of 2025).
        """
        payload = {"model": model, "input": texts}
        response = await self._client.post("/v1/embeddings", json=payload)
        response.raise_for_status()
        data = response.json()
        return [item["embedding"] for item in data["data"]]

    async def get_model_status(self) -> dict[str, bool]:
        """Check which models are available on the LiteLLM gateway."""
        try:
            response = await self._client.get("/v1/models", timeout=5.0)
            response.raise_for_status()
            data = response.json()
            model_ids = {m["id"] for m in data.get("data", [])}
            return {
                "coordinator": settings.litellm_coordinator_model in model_ids,
                "coding": settings.litellm_coding_model in model_ids,
                "arabic": settings.litellm_arabic_model in model_ids,
                "fast": settings.litellm_fast_model in model_ids,
            }
        except Exception as exc:
            log.warning("model_status_check_failed", error=str(exc))
            return {"coordinator": False, "coding": False, "arabic": False, "fast": False}

    async def close(self) -> None:
        await self._client.aclose()
