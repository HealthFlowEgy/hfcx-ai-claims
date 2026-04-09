"""
POST /internal/ai/memory/store
GET  /internal/ai/memory/context/{agent}
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from src.api.middleware import verify_service_jwt
from src.models.schemas import MemoryStoreRequest
from src.services.redis_service import AgentMemoryService

router = APIRouter()


@router.post("/store")
async def store_memory(
    req: MemoryStoreRequest,
    _: str = Depends(verify_service_jwt),
) -> dict:
    svc = AgentMemoryService()
    ok = await svc.store(
        agent_name=req.agent_name,
        pattern_key=req.pattern_key,
        pattern_value=req.pattern_value,
        pattern_type=req.pattern_type,
        confidence=req.confidence,
        claim_id=req.claim_id,
        ttl_seconds=req.ttl_seconds,
    )
    return {"stored": ok, "agent": req.agent_name, "key": req.pattern_key}


@router.get("/context/{agent}")
async def get_agent_context(
    agent: str,
    _: str = Depends(verify_service_jwt),
) -> dict:
    svc = AgentMemoryService()
    patterns = await svc.retrieve_agent_context(agent)
    return {"agent": agent, "patterns": patterns, "count": len(patterns)}
