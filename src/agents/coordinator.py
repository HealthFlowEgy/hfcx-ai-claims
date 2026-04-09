"""
Coordinator Agent — LangGraph multi-agent state machine (SRS 4.1)

Graph topology:
  START → eligibility → [coding, fraud, necessity] (parallel) → adjudicate → END

The coordinator runs inside the Kafka consumer loop. Each FHIR Claim bundle
from hcx.claims.validated is processed as one graph execution.

Lifecycle
─────────
Graph construction is expensive (Redis checkpointer, node wiring). The
CoordinatorAgent is a process-wide singleton (see ``get_coordinator``) and the
graph itself is built lazily inside an async factory — the AsyncRedisSaver is
an async context manager whose lifetime is bound to the process, so we enter it
exactly once at startup and release it on shutdown.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from typing import Any, Optional

import structlog

# LangGraph is a heavy optional dependency — defer import so tests that
# don't actually touch the graph (unit tests for agents, API tests that
# stub CoordinatorAgent) can still import this module.
try:
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver  # type: ignore
    from langgraph.graph import END, START, StateGraph  # type: ignore
    _LANGGRAPH_AVAILABLE = True
except ImportError:  # pragma: no cover — production deploys always have it
    _LANGGRAPH_AVAILABLE = False
    AsyncRedisSaver = None  # type: ignore
    StateGraph = None  # type: ignore
    START = "__start__"  # type: ignore
    END = "__end__"  # type: ignore

from src.agents.eligibility import EligibilityAgent
from src.agents.fraud_detection import FraudDetectionAgent
from src.agents.medical_coding import MedicalCodingAgent
from src.agents.medical_necessity import MedicalNecessityAgent
from src.config import get_settings
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    ClaimAnalysisState,
    EligibilityResult,
    FHIRClaimBundle,
    RiskLevel,
)
from src.services.audit_service import AuditService
from src.utils.metrics import (
    ADJUDICATION_DECISIONS,
    AGENT_LATENCY,
    CLAIMS_PROCESSED,
    FRAUD_HIGH_RISK_CLAIMS,
    FRAUD_SCORE_HISTOGRAM,
)

log = structlog.get_logger(__name__)
settings = get_settings()


# ─────────────────────────────────────────────────────────────────────────────
# Graph node functions
# ─────────────────────────────────────────────────────────────────────────────

async def node_eligibility(state: dict[str, Any]) -> dict[str, Any]:
    """Run eligibility agent. Blocks parallel stage if patient not eligible."""
    if not settings.enable_eligibility_agent:
        return {"eligibility": None}

    agent = EligibilityAgent()
    t0 = time.monotonic()
    try:
        result = await agent.verify(state["claim"])
        duration_ms = int((time.monotonic() - t0) * 1000)
        durations = dict(state.get("agent_durations_ms", {}))
        durations["eligibility"] = duration_ms
        log.info(
            "eligibility_complete",
            claim_id=state["claim"].claim_id,
            eligible=result.is_eligible,
            cache_hit=result.cache_hit,
            ms=duration_ms,
        )
        return {"eligibility": result, "agent_durations_ms": durations}
    except Exception as exc:
        log.error(
            "eligibility_failed",
            error=str(exc),
            claim_id=state["claim"].claim_id,
        )
        return {
            "eligibility": EligibilityResult(
                status=AgentStatus.FAILED, error_message=str(exc)
            )
        }


async def node_parallel_agents(state: dict[str, Any]) -> dict[str, Any]:
    """
    Run coding, fraud, and necessity agents in parallel (asyncio.gather).
    This is the most expensive stage — parallelism keeps total latency < 5s (NFR-001).
    """
    claim: FHIRClaimBundle = state["claim"]

    tasks: list[asyncio.Task] = []
    agents_enabled: list[str] = []

    if settings.enable_coding_agent:
        agents_enabled.append("coding")
        tasks.append(asyncio.create_task(_run_coding(claim)))
    if settings.enable_fraud_agent:
        agents_enabled.append("fraud")
        tasks.append(asyncio.create_task(_run_fraud(claim)))
    if settings.enable_necessity_agent:
        agents_enabled.append("necessity")
        tasks.append(asyncio.create_task(_run_necessity(claim)))

    t0 = time.monotonic()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    duration_ms = int((time.monotonic() - t0) * 1000)

    durations = dict(state.get("agent_durations_ms", {}))
    durations["parallel_stage"] = duration_ms

    updates: dict[str, Any] = {"agent_durations_ms": durations}
    for agent_name, result in zip(agents_enabled, results, strict=True):
        if isinstance(result, Exception):
            log.error("parallel_agent_failed", agent=agent_name, error=str(result))
            updates[agent_name] = None
        else:
            updates[agent_name] = result

    log.info("parallel_agents_complete", claim_id=claim.claim_id, ms=duration_ms)
    return updates


async def _run_coding(claim: FHIRClaimBundle) -> Any:
    agent = MedicalCodingAgent()
    return await agent.validate(claim)


async def _run_fraud(claim: FHIRClaimBundle) -> Any:
    agent = FraudDetectionAgent()
    return await agent.score(claim)


async def _run_necessity(claim: FHIRClaimBundle) -> Any:
    agent = MedicalNecessityAgent()
    return await agent.assess(claim)


async def node_adjudicate(state: dict[str, Any]) -> dict[str, Any]:
    """
    Final adjudication node — combines all agent signals into a decision.
    Implements the SRS adjudication logic with human-in-the-loop routing.
    """
    claim: FHIRClaimBundle = state["claim"]
    eligibility = state.get("eligibility")
    coding = state.get("coding")
    fraud = state.get("fraud")
    necessity = state.get("necessity")

    reasons: list[str] = []
    human_review_reasons: list[str] = []
    confidence_scores: list[float] = []
    decision = AdjudicationDecision.APPROVED

    # ── Eligibility gate ──────────────────────────────────────────────────
    if eligibility and eligibility.status == AgentStatus.COMPLETED:
        if not eligibility.is_eligible:
            decision = AdjudicationDecision.DENIED
            reasons.append(f"Patient {claim.patient_id} not eligible for coverage")
        elif not eligibility.coverage_active:
            decision = AdjudicationDecision.DENIED
            reasons.append("Coverage not active on service date")

    # ── Fraud gate ────────────────────────────────────────────────────────
    if fraud and fraud.status == AgentStatus.COMPLETED and fraud.fraud_score is not None:
        confidence_scores.append(1.0 - fraud.fraud_score)
        FRAUD_SCORE_HISTOGRAM.observe(fraud.fraud_score)

        if fraud.risk_level == RiskLevel.CRITICAL:
            decision = AdjudicationDecision.DENIED
            reasons.append(f"Critical fraud risk (score={fraud.fraud_score:.2f})")
            FRAUD_HIGH_RISK_CLAIMS.inc()
        elif fraud.risk_level == RiskLevel.HIGH:
            if decision == AdjudicationDecision.APPROVED:
                decision = AdjudicationDecision.PENDED
            human_review_reasons.append(f"High fraud risk score: {fraud.fraud_score:.2f}")
            FRAUD_HIGH_RISK_CLAIMS.inc()
        elif fraud.risk_level == RiskLevel.MEDIUM:
            human_review_reasons.append(f"Medium fraud risk: {fraud.fraud_score:.2f}")

        if fraud.refer_to_siu:
            human_review_reasons.append("Referred to Special Investigations Unit")

    # ── Coding gate ───────────────────────────────────────────────────────
    if coding and coding.status == AgentStatus.COMPLETED:
        if coding.confidence_score is not None:
            confidence_scores.append(coding.confidence_score)

        if not coding.all_codes_valid:
            if decision == AdjudicationDecision.APPROVED:
                decision = AdjudicationDecision.PENDED
            human_review_reasons.append(
                "ICD-10 coding errors detected — manual verification required"
            )

    # ── Medical necessity gate ────────────────────────────────────────────
    if necessity and necessity.status == AgentStatus.COMPLETED:
        if necessity.confidence_score is not None:
            confidence_scores.append(necessity.confidence_score)

        if necessity.is_medically_necessary is False:
            if decision == AdjudicationDecision.APPROVED:
                decision = AdjudicationDecision.PENDED
            human_review_reasons.append(
                "Medical necessity not established — requires clinical review"
            )

        if necessity.eda_formulary_status == "unlisted":
            human_review_reasons.append("Drug not listed in EDA formulary")

    # ── Overall confidence ────────────────────────────────────────────────
    overall_confidence = (
        sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.5
    )
    requires_human_review = len(human_review_reasons) > 0

    ADJUDICATION_DECISIONS.labels(decision=decision.value).inc()
    CLAIMS_PROCESSED.inc()

    log.info(
        "adjudication_complete",
        claim_id=claim.claim_id,
        decision=decision,
        confidence=overall_confidence,
        human_review=requires_human_review,
    )

    # Audit (SEC-003) — append-only, PHI-free
    try:
        await AuditService.record(
            event_type="ai.recommended",
            correlation_id=claim.hcx_correlation_id,
            claim_id=claim.claim_id,
            agent_name="coordinator",
            action="adjudicate",
            outcome="ok",
            decision=decision.value,
            fraud_risk_level=(fraud.risk_level.value if fraud and fraud.risk_level else None),
            model_used=settings.litellm_coordinator_model,
        )
    except Exception as exc:  # pragma: no cover — audit failures never block claims
        log.warning("audit_write_failed", error=str(exc))

    return {
        "adjudication_decision": decision,
        "overall_confidence": overall_confidence,
        "requires_human_review": requires_human_review,
        "human_review_reasons": human_review_reasons,
        "completed_at": datetime.now(timezone.utc),
    }


def should_run_parallel(state: dict[str, Any]) -> str:
    """
    Conditional edge: skip parallel agents if patient is clearly not eligible
    (saves GPU time and reduces latency for hard-deny cases).
    """
    eligibility = state.get("eligibility")
    if eligibility and eligibility.status == AgentStatus.COMPLETED:
        if not eligibility.is_eligible and not eligibility.coverage_active:
            log.info("skipping_parallel_agents", reason="patient_not_eligible")
            return "adjudicate"
    return "parallel"


# ─────────────────────────────────────────────────────────────────────────────
# Graph assembly
# ─────────────────────────────────────────────────────────────────────────────

async def build_coordinator_graph(
    redis_url: str, exit_stack: AsyncExitStack
) -> Any:
    """
    Build and compile the LangGraph state machine.
    Uses AsyncRedisSaver for checkpoint/resume on pod failure (NFR-004).

    AsyncRedisSaver.from_conn_string returns an async context manager; we enter
    it via an exit_stack owned by the calling CoordinatorAgent so cleanup happens
    on shutdown.
    """
    if not _LANGGRAPH_AVAILABLE:
        raise RuntimeError(
            "langgraph is not installed — cannot build coordinator graph. "
            "Install via `pip install -e .` which pulls langgraph 0.6.7+."
        )

    graph: StateGraph = StateGraph(dict)  # type: ignore[misc]

    graph.add_node("eligibility", node_eligibility)
    graph.add_node("parallel", node_parallel_agents)
    graph.add_node("adjudicate", node_adjudicate)

    graph.add_edge(START, "eligibility")
    graph.add_conditional_edges(
        "eligibility",
        should_run_parallel,
        {"parallel": "parallel", "adjudicate": "adjudicate"},
    )
    graph.add_edge("parallel", "adjudicate")
    graph.add_edge("adjudicate", END)

    checkpointer = await exit_stack.enter_async_context(
        AsyncRedisSaver.from_conn_string(redis_url)
    )
    # Some checkpointer implementations require an explicit setup() call.
    setup = getattr(checkpointer, "asetup", None) or getattr(checkpointer, "setup", None)
    if setup is not None:
        maybe_coro = setup()
        if asyncio.iscoroutine(maybe_coro):
            await maybe_coro

    return graph.compile(checkpointer=checkpointer)


# ─────────────────────────────────────────────────────────────────────────────
# CoordinatorAgent — public interface
# ─────────────────────────────────────────────────────────────────────────────

class CoordinatorAgent:
    """
    Process-wide entry point for the AI Intelligence Layer.

    Construction is cheap; the actual LangGraph graph is built lazily on first
    use via :meth:`ensure_ready`. The graph is shared across all callers in the
    process (Kafka consumer and FastAPI request handlers both reuse the single
    compiled graph — see FR-AO-001 latency budget).
    """

    _instance: Optional["CoordinatorAgent"] = None
    _lock: asyncio.Lock = asyncio.Lock()

    def __init__(self) -> None:
        self._graph: Any | None = None
        self._exit_stack: AsyncExitStack = AsyncExitStack()
        self._ready: bool = False

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            self._graph = await build_coordinator_graph(
                str(settings.redis_url), self._exit_stack
            )
            self._ready = True
            log.info("coordinator_graph_ready")

    async def shutdown(self) -> None:
        if self._ready:
            await self._exit_stack.aclose()
            self._ready = False
            self._graph = None
            log.info("coordinator_graph_shutdown")

    async def process_claim(self, claim: FHIRClaimBundle) -> ClaimAnalysisState:
        await self.ensure_ready()
        t0 = time.monotonic()

        initial_state: dict[str, Any] = {
            "claim": claim,
            "correlation_id": claim.hcx_correlation_id,
            "started_at": datetime.now(timezone.utc),
            "agent_durations_ms": {},
        }

        config = {
            "configurable": {"thread_id": claim.hcx_correlation_id or claim.claim_id},
            "recursion_limit": 10,
        }

        try:
            with AGENT_LATENCY.labels(agent="coordinator").time():
                assert self._graph is not None
                final_state = await self._graph.ainvoke(initial_state, config=config)
        except Exception as exc:
            log.error(
                "coordinator_failed",
                claim_id=claim.claim_id,
                error=str(exc),
                exc_info=True,
            )
            if settings.ai_bypass_on_failure:
                # Graceful degradation: pended for human review (NFR-004)
                ADJUDICATION_DECISIONS.labels(decision=AdjudicationDecision.PENDED.value).inc()
                return ClaimAnalysisState(
                    claim=claim,
                    correlation_id=claim.hcx_correlation_id,
                    adjudication_decision=AdjudicationDecision.PENDED,
                    overall_confidence=0.0,
                    requires_human_review=True,
                    human_review_reasons=["AI layer error — routed to manual queue"],
                )
            raise

        total_ms = int((time.monotonic() - t0) * 1000)
        final_state.setdefault("agent_durations_ms", {})["total"] = total_ms

        return ClaimAnalysisState(
            **{
                k: v
                for k, v in final_state.items()
                if k in ClaimAnalysisState.model_fields
            }
        )


# ─────────────────────────────────────────────────────────────────────────────
# Process-wide singleton
# ─────────────────────────────────────────────────────────────────────────────

_coordinator: CoordinatorAgent | None = None


def get_coordinator() -> CoordinatorAgent:
    """Return the process-wide CoordinatorAgent singleton."""
    global _coordinator
    if _coordinator is None:
        _coordinator = CoordinatorAgent()
    return _coordinator


async def shutdown_coordinator() -> None:
    global _coordinator
    if _coordinator is not None:
        await _coordinator.shutdown()
        _coordinator = None
