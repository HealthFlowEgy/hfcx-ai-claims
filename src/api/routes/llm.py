"""
POST /internal/ai/llm/completion — model-agnostic LLM completion (SRS 6.2)

Used by operators and other internal services that need the LiteLLM gateway
without going through an agent. Service JWT protected (SEC-001).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.api.middleware import verify_service_jwt
from src.models.schemas import LLMCompletionRequest, LLMCompletionResponse
from src.services.llm_service import COORDINATOR_MODEL_ALIAS, LLMService

router = APIRouter()


@router.post("/completion", response_model=LLMCompletionResponse)
async def llm_completion(
    req: LLMCompletionRequest,
    _: str = Depends(verify_service_jwt),
) -> LLMCompletionResponse:
    svc = LLMService()
    target_model = req.model or COORDINATOR_MODEL_ALIAS
    try:
        content = await svc.complete(
            prompt=req.prompt,
            model=target_model,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            system_prompt=req.system_prompt,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM gateway error: {exc}") from exc
    return LLMCompletionResponse(model=target_model, content=content)
