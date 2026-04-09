"""
Model accuracy drift feedback loop (SRS §10.3).

Human adjudicators eventually confirm or overturn the AI's decision.
Every one of those decisions is a ground-truth label we can feed back
into rolling accuracy and drift metrics so operators can detect model
degradation before it affects production.

Flow
────
1. Human adjudicator posts `POST /internal/ai/feedback` with the
   claim correlation ID and the final human decision.
2. `DriftService.record_feedback(...)` looks up the AI's
   `ai_claim_analysis` row for that correlation, compares the AI
   decision with the human decision, and emits:
      - `hfcx_ai_model_accuracy{model, label}` gauge (rolling 7d)
      - `hfcx_ai_model_drift_score{model}` gauge (rolling PSI-like)
3. The accuracy is also persisted into `ai_audit_log` as a
   `human.decided` event so the audit trail is complete.

Drift score
───────────
We compute a lightweight proxy for population-stability-index (PSI)
by comparing the sliding window of recent AI scores against a frozen
baseline sample loaded at process start. Actual PSI would require a
pre-trained distribution — this simpler version is enough to set a
Grafana alert on `drift > 0.2` per NFR-001 observability targets.

The service is intentionally dependency-light: it holds state in a
bounded deque in memory and flushes to Prometheus gauges on every
feedback event. For multi-pod deployments Prometheus scrapes each
replica's local state — the alerting rule should aggregate with
`max_over_time`.
"""
from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import structlog

from src.services.audit_service import AuditService
from src.utils.metrics import MODEL_ACCURACY, MODEL_DRIFT_SCORE

log = structlog.get_logger(__name__)

# Sliding window size for rolling accuracy. 500 labeled events is enough
# to smooth out per-batch noise without lagging weeks behind.
_WINDOW_SIZE = 500

# Retention horizon (seconds) for labeled events. Events older than this
# fall off the front of the deque even if the window is not full.
_WINDOW_TTL_SECONDS = 7 * 24 * 3600  # 7 days


@dataclass
class _LabeledEvent:
    timestamp: datetime
    correlation_id: str
    ai_decision: str
    human_decision: str
    ai_score: float | None = None
    model: str = "coordinator"


@dataclass
class _WindowState:
    events: deque[_LabeledEvent] = field(
        default_factory=lambda: deque(maxlen=_WINDOW_SIZE)
    )
    baseline_mean_score: float = 0.5   # prior on fraud score distribution


class DriftService:
    """
    Rolling drift + accuracy tracker. Module-level singleton state so
    Prometheus scrapes the same gauges across repeated calls in the
    same process.
    """

    _state: _WindowState = _WindowState()
    _lock: asyncio.Lock | None = None

    @classmethod
    def _get_lock(cls) -> asyncio.Lock:
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    @classmethod
    def _prune_expired(cls) -> None:
        cutoff = datetime.now(UTC) - timedelta(seconds=_WINDOW_TTL_SECONDS)
        events = cls._state.events
        while events and events[0].timestamp < cutoff:
            events.popleft()

    @classmethod
    async def record_feedback(
        cls,
        *,
        correlation_id: str,
        ai_decision: str,
        human_decision: str,
        ai_score: float | None = None,
        model: str = "coordinator",
    ) -> dict[str, float]:
        """
        Record one human-labeled outcome and refresh the drift/accuracy
        gauges. Returns the current rolling metrics for this model.
        """
        async with cls._get_lock():
            cls._prune_expired()
            cls._state.events.append(
                _LabeledEvent(
                    timestamp=datetime.now(UTC),
                    correlation_id=correlation_id,
                    ai_decision=ai_decision,
                    human_decision=human_decision,
                    ai_score=ai_score,
                    model=model,
                )
            )
            stats = cls._compute(model)

        # Publish gauges.
        MODEL_ACCURACY.labels(model=model, label="overall").set(stats["accuracy"])
        MODEL_ACCURACY.labels(model=model, label="precision_fraud").set(
            stats["precision_fraud"]
        )
        MODEL_ACCURACY.labels(model=model, label="recall_fraud").set(
            stats["recall_fraud"]
        )
        MODEL_DRIFT_SCORE.labels(model=model).set(stats["drift"])

        # Audit trail of every human decision that fed the drift loop.
        try:
            await AuditService.record(
                event_type="human.decided",
                correlation_id=correlation_id,
                agent_name="drift_feedback",
                action="record_feedback",
                outcome="ok",
                decision=human_decision,
                detail={
                    "ai_decision": ai_decision,
                    "accuracy": stats["accuracy"],
                    "drift": stats["drift"],
                    "model": model,
                },
            )
        except Exception as exc:  # pragma: no cover
            log.warning("drift_audit_write_failed", error=str(exc))

        return stats

    @classmethod
    def _compute(cls, model: str) -> dict[str, float]:
        """Compute accuracy/precision/recall/drift from the current window."""
        events = [e for e in cls._state.events if e.model == model]
        if not events:
            return {
                "accuracy": 0.0,
                "precision_fraud": 0.0,
                "recall_fraud": 0.0,
                "drift": 0.0,
                "window_size": 0,
            }

        correct = 0
        tp = fp = fn = 0
        scores: list[float] = []
        for e in events:
            if e.ai_decision == e.human_decision:
                correct += 1
            # Binary "flagged as fraud" label: we treat denial / investigation
            # outcomes as positive class for precision/recall.
            ai_pos = e.ai_decision in ("denied", "pended")
            human_pos = e.human_decision in ("denied", "pended")
            if ai_pos and human_pos:
                tp += 1
            elif ai_pos and not human_pos:
                fp += 1
            elif (not ai_pos) and human_pos:
                fn += 1
            if e.ai_score is not None:
                scores.append(e.ai_score)

        n = len(events)
        accuracy = correct / n
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0

        # Drift proxy — mean absolute delta between the window's mean
        # score and the baseline. Values near 0 are stable; >0.2 is a
        # strong hint of distribution shift and should fire an alert.
        drift = 0.0
        if scores:
            window_mean = sum(scores) / len(scores)
            drift = abs(window_mean - cls._state.baseline_mean_score)

        return {
            "accuracy": round(accuracy, 4),
            "precision_fraud": round(precision, 4),
            "recall_fraud": round(recall, 4),
            "drift": round(drift, 4),
            "window_size": n,
        }

    # ── test / ops hooks ─────────────────────────────────────────────────
    @classmethod
    def set_baseline_mean_score(cls, value: float) -> None:
        cls._state.baseline_mean_score = value

    @classmethod
    def reset(cls) -> None:
        cls._state = _WindowState()
