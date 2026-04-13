"""
Unit tests for LLMService — the happy path + error propagation.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services.llm_service import LLMService


@pytest.mark.asyncio
async def test_llm_complete_happy_path():
    response = MagicMock()
    response.raise_for_status = MagicMock(return_value=None)
    response.json = MagicMock(
        return_value={
            "choices": [{"message": {"content": "hello from LLM"}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 4},
        }
    )

    client = MagicMock()
    client.post = AsyncMock(return_value=response)

    svc = LLMService(client=client)
    out = await svc.complete(prompt="hi", model="coordinator-model")
    assert out == "hello from LLM"

    # Ensure we hit the chat completions endpoint
    assert client.post.await_args.args[0] == "/v1/chat/completions"


@pytest.mark.asyncio
async def test_llm_embed():
    response = MagicMock()
    response.raise_for_status = MagicMock(return_value=None)
    response.json = MagicMock(
        return_value={"data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]}
    )

    client = MagicMock()
    client.post = AsyncMock(return_value=response)

    svc = LLMService(client=client)
    out = await svc.embed(["a", "b"])
    assert out == [[0.1, 0.2], [0.3, 0.4]]


@pytest.mark.asyncio
async def test_llm_get_model_status():
    response = MagicMock()
    response.raise_for_status = MagicMock(return_value=None)
    response.json = MagicMock(
        return_value={
            "data": [
                {"id": "coordinator-model"},
                {"id": "gpt-4o"},
                {"id": "gpt-4o-mini"},
            ]
        }
    )
    client = MagicMock()
    client.get = AsyncMock(return_value=response)

    svc = LLMService(client=client)
    status = await svc.get_model_status()
    assert status["coordinator"] is True
    assert status["coding"] is True   # gpt-4o matches litellm_coding_model
    assert status["arabic"] is True   # gpt-4o matches litellm_arabic_model
    assert status["fast"] is True     # gpt-4o-mini matches litellm_fast_model
