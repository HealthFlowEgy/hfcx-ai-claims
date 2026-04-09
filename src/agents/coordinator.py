"""
Coordinator Agent — LangGraph multi-agent state machine (SRS 4.1)

Graph topology:
  START → eligibility → [coding, fraud, necessity] (parallel) → adjudicate → END

The coordinator runs inside the Kafka consumer loop. Each FHIR Claim bundle
from hcx.claims.validated is processed as one graph execution.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.redis import AsyncRedisSaver

from src.agents.eligibility import EligibilityAgent
from src.agents.fraud_detection import FraudDetectionAgent
from src.agents.medical_coding import MedicalCodingAgent
from src.agents.medical_necessity import MedicalNecessityAgent
from src.config import get_settings
from src.models.schemas import (
    AdjudicationDecision,
    AgentStatus,
    ClaimAnalysisState,
    FHIRClaimBundle,
    RiskLevel,
)
from src.utils.metrics import CLAIMS_PROCESSED, AGENT_LATENCY, ADJUDICATION_DECISIONS

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
        log.info("eligibility_complete", claim_id=state["claim"].claim_id,
                 eligible=result.is_eligible, cache_hit=result.cache_hit, ms=duration_ms)
        return {"eligibility": result, "agent_durations_ms": durations}
    except Exception as exc:
        log.error("eligibility_failed", error=str(exc), claim_id=state["claim"].claim_id)
        from src.models.schemas import EligibilityResult
        return {"eligibility": EligibilityResult(status=AgentStatus.FAILED, error_message=str(exc))}


async def node_parallel_agents(state: dict[str, Any]) -> dict[str, Any]:
    """
    Run coding, fraud, and necessity agents in parallel (asyncio.gather).
    This is the most expensive stage — parallelism keeps total latency < 5s (NFR-001).
    """
    claim: FHIRClaimBundle = state["claim"]

    tasks: list[asyncio.Task] = []
    agents_enabled = []

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
    for agent_name, result in zip(agents_enabled, results):
        if isinstance(result, Exception):
            log.error("parallel_agent_failed", agent=agent_name, error=str(result))
            updates[agent_name] = None
        else:
            updates[agent_name] = result

    log.info("parallel_agents_complete", claim_id=claim.claim_id, ms=duration_ms)
    return updates


async def _run_coding(claim: FHIRClaimBundle):
    agent = MedicalCodingAgent()
    return await agent.validate(claim)


async def _run_fraud(claim: FHIRClaimBundle):
    agent = FraudDetectionAgent()
    return await agent.score(claim)


async def _run_necessity(claim: FHIRClaimBundle):
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
        confidence_scores.append(1.0 - fraud.fraud_score)  # Invert fraud score to confidence

        if fraud.risk_level == RiskLevel.CRITICAL:
            decision = AdjudicationDecision.DENIED
            reasons.append(f"Critical fraud risk (score={fraud.fraud_score:.2f})")
        elif fraud.risk_level == RiskLevel.HIGH:
            if decision == AdjudicationDecision.APPROVED:
                decision = AdjudicationDecision.PENDED
            human_review_reasons.append(f"High fraud risk score: {fraud.fraud_score:.2f}")
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
            human_review_reasons.append("ICD-10 coding errors detected — manual verification required")

    # ── Medical necessity gate ────────────────────────────────────────────
    if necessity and necessity.status == AgentStatus.COMPLETED:
        if necessity.confidence_score is not None:
            confidence_scores.append(necessity.confidence_score)

        if necessity.is_medically_necessary is False:
            if decision == AdjudicationDecision.APPROVED:
                decision = AdjudicationDecision.PENDED
            human_review_reasons.append("Medical necessity not established — requires clinical review")

        if necessity.eda_formulary_status == "unlisted":
            human_review_reasons.append("Drug not listed in EDA formulary")

    # ── Overall confidence ────────────────────────────────────────────────
    overall_confidence = (
        sum(confidence_scores) / len(confidence_scores)
        if confidence_scores else 0.5
    )
    requires_human_review = len(human_review_reasons) > 0

    # Record metric
    ADJUDICATION_DECISIONS.labels(decision=decision.value).inc()
    CLAIMS_PROCESSED.inc()

    log.info(
        "adjudication_complete",
        claim_id=claim.claim_id,
        decision=decision,
        confidence=overall_confidence,
        human_review=requires_human_review,
    )

    return {
        "adjudication_decision": decision,
        "overall_confidence": overall_confidence,
        "requires_human_review": requires_human_review,
        "human_review_reasons": human_review_reasons,
        "completed_at": __import__("datetime").datetime.utcnow(),
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

def build_coordinator_graph(redis_url: str) -> Any:
    """
    Build and compile the LangGraph state machine.
    Uses AsyncRedisSaver for checkpoint/resume on pod failure (NFR-004).
    """
    graph = StateGraph(dict)

    # Nodes
    graph.add_node("eligibility", node_eligibility)
    graph.add_node("parallel", node_parallel_agents)
    graph.add_node("adjudicate", node_adjudicate)

    # Edges
    graph.add_edge(START, "eligibility")
    graph.add_conditional_edges(
        "eligibility",
        should_run_parallel,
        {"parallel": "parallel", "adjudicate": "adjudicate"},
    )
    graph.add_edge("parallel", "adjudicate")
    graph.add_edge("adjudicate", END)

    # Redis checkpointing for fault tolerance
    checkpointer = AsyncRedisSaver.from_conn_string(redis_url)
    return graph.compile(checkpointer=checkpointer)


# ─────────────────────────────────────────────────────────────────────────────
# CoordinatorAgent — public interface
# ─────────────────────────────────────────────────────────────────────────────

class CoordinatorAgent:
    """
    Entry point for the AI Intelligence Layer.
    Called by the Kafka consumer for each ClaimReceived event.
    """

    def __init__(self) -> None:
        self._graph = build_coordinator_graph(str(settings.redis_url))

    async def process_claim(self, claim: FHIRClaimBundle) -> ClaimAnalysisState:
        t0 = time.monotonic()

        initial_state: dict[str, Any] = {
            "claim": claim,
            "correlation_id": claim.hcx_correlation_id,
            "started_at": __import__("datetime").datetime.utcnow(),
            "agent_durations_ms": {},
        }

        config = {
            "configurable": {"thread_id": claim.hcx_correlation_id},
            "recursion_limit": 10,
        }

        try:
            with AGENT_LATENCY.labels(agent="coordinator").time():
                final_state = await self._graph.ainvoke(initial_state, config=config)
        except Exception as exc:
            log.error(
                "coordinator_failed",
                claim_id=claim.claim_id,
                error=str(exc),
                exc_info=True,
            )
            if settings.ai_bypass_on_failure:
                # Graceful degradation: return pended decision for human review (NFR-004)
                return ClaimAnalysisState(
                    claim=claim,
                    adjudication_decision=AdjudicationDecision.PENDED,
                    overall_confidence=0.0,
                    requires_human_review=True,
                    human_review_reasons=["AI layer error — routed to manual queue"],
                )
            raise

        total_ms = int((time.monotonic() - t0) * 1000)
        final_state["agent_durations_ms"]["total"] = total_ms

        return ClaimAnalysisState(**{
            k: v for k, v in final_state.items()
            if k in ClaimAnalysisState.model_fields
        })
