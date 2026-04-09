"""
Pydantic schemas — request/response models and internal data contracts.
All schemas mirror the SRS Section 5 data model and Section 6 API spec.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────────────
# Enumerations
# ─────────────────────────────────────────────────────────────────────────────

class ClaimType(str, Enum):
    OUTPATIENT = "outpatient"
    INPATIENT = "inpatient"
    PHARMACY = "pharmacy"
    LAB = "lab"
    DENTAL = "dental"
    VISION = "vision"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AgentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    BYPASSED = "bypassed"


class AdjudicationDecision(str, Enum):
    APPROVED = "approved"
    DENIED = "denied"
    PENDED = "pended"           # Requires human review
    PARTIAL = "partial"         # Partially approved


# ─────────────────────────────────────────────────────────────────────────────
# FHIR Claim Bundle (incoming from hcx-pipeline-jobs via Kafka)
# ─────────────────────────────────────────────────────────────────────────────

class FHIRClaimBundle(BaseModel):
    """
    Simplified FHIR R4 Claim Bundle received from Kafka topic hcx.claims.validated.
    The full bundle arrives as raw JSON; this schema extracts the fields the AI layer needs.
    """
    # HCX Protocol Headers (from X-HCX-* headers, embedded in Kafka message)
    hcx_sender_code: str = Field(..., description="Sender participant code from HCX registry")
    hcx_recipient_code: str = Field(..., description="Payer participant code")
    hcx_correlation_id: str = Field(..., description="X-HCX-Correlation-ID for tracing")
    hcx_workflow_id: str = Field(..., description="X-HCX-Workflow-ID")
    hcx_api_call_id: str = Field(..., description="Unique call ID for idempotency")

    # FHIR Claim resource (core)
    claim_id: str = Field(..., description="FHIR Claim.id")
    claim_type: ClaimType
    patient_id: str = Field(..., description="NHIA beneficiary ID (National ID-based)")
    provider_id: str = Field(..., description="HCP Registry provider ID")
    payer_id: str = Field(..., description="Insurance company ID")

    # Clinical data
    diagnosis_codes: list[str] = Field(default_factory=list, description="ICD-10 codes")
    procedure_codes: list[str] = Field(default_factory=list, description="CPT/SNOMED procedure codes")
    total_amount: float = Field(..., description="Claim total in EGP")
    claim_date: datetime
    service_date: datetime

    # Drug data (pharmacy claims)
    drug_codes: list[str] = Field(default_factory=list, description="EDA drug codes")
    prescription_id: str | None = None

    # Attachments
    attachment_ids: list[str] = Field(default_factory=list, description="MinIO object IDs")
    clinical_notes: str | None = Field(None, description="Free-text clinical notes (Arabic/English)")

    # Raw FHIR bundle for agents that need full resource access
    raw_fhir_bundle: dict[str, Any] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Agent Results
# ─────────────────────────────────────────────────────────────────────────────

class EligibilityResult(BaseModel):
    status: AgentStatus
    is_eligible: bool | None = None
    coverage_active: bool | None = None
    coverage_type: str | None = None
    deductible_remaining: float | None = None
    copay_percentage: float | None = None
    exclusions: list[str] = Field(default_factory=list)
    cache_hit: bool = False
    checked_at: datetime = Field(default_factory=datetime.utcnow)
    error_message: str | None = None


class CodingValidationResult(BaseModel):
    status: AgentStatus
    all_codes_valid: bool | None = None
    icd10_validations: list[dict[str, Any]] = Field(default_factory=list)
    procedure_validations: list[dict[str, Any]] = Field(default_factory=list)
    suggested_corrections: list[dict[str, Any]] = Field(default_factory=list)
    confidence_score: float | None = Field(None, ge=0.0, le=1.0)
    arabic_entities_extracted: list[str] = Field(default_factory=list)
    error_message: str | None = None


class FraudDetectionResult(BaseModel):
    status: AgentStatus
    fraud_score: float | None = Field(None, ge=0.0, le=1.0)
    risk_level: RiskLevel | None = None
    anomaly_flags: list[dict[str, Any]] = Field(default_factory=list)
    network_risk_indicators: list[str] = Field(default_factory=list)
    billing_pattern_flags: list[str] = Field(default_factory=list)
    isolation_forest_score: float | None = None
    xgboost_score: float | None = None
    pyod_ensemble_score: float | None = None
    refer_to_siu: bool = False          # Special Investigations Unit
    error_message: str | None = None


class MedicalNecessityResult(BaseModel):
    status: AgentStatus
    is_medically_necessary: bool | None = None
    confidence_score: float | None = Field(None, ge=0.0, le=1.0)
    supporting_evidence: list[str] = Field(default_factory=list)
    clinical_guidelines_referenced: list[str] = Field(default_factory=list)
    eda_formulary_status: str | None = None   # "listed" | "unlisted" | "restricted"
    alternative_suggestions: list[str] = Field(default_factory=list)
    arabic_summary: str | None = None         # Arabic clinical summary for payer
    error_message: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator — Graph State (SRS Section 4.1)
# ─────────────────────────────────────────────────────────────────────────────

class ClaimAnalysisState(BaseModel):
    """LangGraph state object passed between nodes in the coordinator graph."""
    # Input
    claim: FHIRClaimBundle
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = Field(default_factory=datetime.utcnow)

    # Agent results (populated as graph executes)
    eligibility: EligibilityResult | None = None
    coding: CodingValidationResult | None = None
    fraud: FraudDetectionResult | None = None
    necessity: MedicalNecessityResult | None = None

    # Final decision
    adjudication_decision: AdjudicationDecision | None = None
    overall_confidence: float | None = None
    requires_human_review: bool = False
    human_review_reasons: list[str] = Field(default_factory=list)
    completed_at: datetime | None = None

    # Telemetry
    agent_durations_ms: dict[str, int] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# API Request / Response Schemas (Section 6.2)
# ─────────────────────────────────────────────────────────────────────────────

class AICoordinateRequest(BaseModel):
    """POST /internal/ai/coordinate"""
    fhir_claim_bundle: dict[str, Any] = Field(..., description="Raw FHIR Claim bundle JSON")
    hcx_headers: dict[str, str] = Field(..., description="HCX protocol headers")


class AICoordinateResponse(BaseModel):
    correlation_id: str
    claim_id: str
    adjudication_decision: AdjudicationDecision
    overall_confidence: float
    requires_human_review: bool
    human_review_reasons: list[str]
    eligibility: EligibilityResult
    coding: CodingValidationResult
    fraud: FraudDetectionResult
    necessity: MedicalNecessityResult
    processing_time_ms: int
    fhir_extensions: list[dict[str, Any]] = Field(
        default_factory=list,
        description="FHIR ClaimResponse.extension[] entries containing AI results"
    )


class EligibilityVerifyRequest(BaseModel):
    """POST /internal/ai/agents/eligibility/verify"""
    patient_id: str
    payer_id: str
    provider_id: str
    service_date: datetime
    claim_type: ClaimType
    force_refresh: bool = False


class CodingValidateRequest(BaseModel):
    """POST /internal/ai/agents/coding/validate"""
    diagnosis_codes: list[str]
    procedure_codes: list[str]
    clinical_notes: str | None = None
    claim_type: ClaimType


class FraudScoreRequest(BaseModel):
    """POST /internal/ai/agents/fraud/score"""
    claim_id: str
    provider_id: str
    patient_id: str
    total_amount: float
    diagnosis_codes: list[str]
    procedure_codes: list[str]
    claim_date: datetime
    service_date: datetime
    claim_type: ClaimType


class NecessityAssessRequest(BaseModel):
    """POST /internal/ai/agents/necessity/assess"""
    diagnosis_codes: list[str]
    procedure_codes: list[str]
    drug_codes: list[str]
    clinical_notes: str | None = None
    claim_type: ClaimType
    total_amount: float


class MemoryStoreRequest(BaseModel):
    """POST /internal/ai/memory/store"""
    agent_name: str
    claim_id: str
    pattern_key: str
    pattern_value: dict[str, Any]
    ttl_seconds: int | None = None


class HealthCheckResponse(BaseModel):
    status: str
    version: str
    models_available: dict[str, bool]
    kafka_connected: bool
    redis_connected: bool
    postgres_connected: bool
    chromadb_connected: bool
    queue_depth: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Kafka Message Envelopes
# ─────────────────────────────────────────────────────────────────────────────

class KafkaClaimMessage(BaseModel):
    """Message schema for hcx.claims.validated topic."""
    event_type: str = "ClaimReceived"
    schema_version: str = "1.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: dict[str, Any]                   # Raw FHIR bundle
    hcx_headers: dict[str, str] = Field(default_factory=dict)


class KafkaEnrichedClaimMessage(BaseModel):
    """Message schema for hcx.claims.enriched topic."""
    event_type: str = "ClaimEnriched"
    schema_version: str = "1.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    correlation_id: str
    claim_id: str
    hcx_headers: dict[str, str] = Field(default_factory=dict)
    payload: dict[str, Any]                   # Original FHIR bundle
    ai_analysis: dict[str, Any]               # Serialized ClaimAnalysisState
    fhir_extensions: list[dict[str, Any]]     # For FHIR ClaimResponse
