"""
POST /internal/ai/feedback — human-in-the-loop drift feedback (SRS §10.3).

Human adjudicators post the final outcome so the DriftService can
update rolling accuracy + drift gauges for Grafana alerting.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from src.api.middleware import verify_service_jwt
from src.services.drift_service import DriftService

router = APIRouter()


class FeedbackRequest(BaseModel):
    correlation_id: str
    ai_decision: str = Field(..., description="What the AI layer recommended")
    human_decision: str = Field(..., description="What the human adjudicator decided")
    ai_score: float | None = Field(default=None, ge=0.0, le=1.0)
    model: str = "coordinator"


class FeedbackResponse(BaseModel):
    accuracy: float
    precision_fraud: float
    recall_fraud: float
    drift: float
    window_size: int


def _coerce_stats(raw: dict) -> dict:
    return {
        "accuracy": float(raw.get("accuracy", 0.0)),
        "precision_fraud": float(raw.get("precision_fraud", 0.0)),
        "recall_fraud": float(raw.get("recall_fraud", 0.0)),
        "drift": float(raw.get("drift", 0.0)),
        "window_size": int(raw.get("window_size", 0)),
    }


@router.post("/feedback", response_model=FeedbackResponse)
async def record_feedback(
    req: FeedbackRequest,
    _: str = Depends(verify_service_jwt),
) -> FeedbackResponse:
    stats = await DriftService.record_feedback(
        correlation_id=req.correlation_id,
        ai_decision=req.ai_decision,
        human_decision=req.human_decision,
        ai_score=req.ai_score,
        model=req.model,
    )
    return FeedbackResponse(**_coerce_stats(stats))
