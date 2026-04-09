"""
Individual agent API endpoints (SRS Section 6.2)
POST /internal/ai/agents/eligibility/verify
POST /internal/ai/agents/coding/validate
POST /internal/ai/agents/fraud/score
POST /internal/ai/agents/necessity/assess
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from src.agents.eligibility import EligibilityAgent
from src.agents.fraud_detection import FraudDetectionAgent
from src.agents.medical_coding import MedicalCodingAgent
from src.agents.medical_necessity import MedicalNecessityAgent
from src.api.middleware import verify_service_jwt
from src.models.schemas import (
    CodingValidateRequest,
    CodingValidationResult,
    EligibilityResult,
    EligibilityVerifyRequest,
    FHIRClaimBundle,
    FraudDetectionResult,
    FraudScoreRequest,
    MedicalNecessityResult,
    NecessityAssessRequest,
)

router = APIRouter()

# Sentinels — acceptable placeholders validated by FHIRClaimBundle/Request models.
_API_PATIENT_PLACEHOLDER = "api-check"
_API_CALL_ID = "direct-api-call"


def _now() -> datetime:
    return datetime.now(UTC)


@router.post("/eligibility/verify", response_model=EligibilityResult)
async def verify_eligibility(
    req: EligibilityVerifyRequest,
    _: str = Depends(verify_service_jwt),
) -> EligibilityResult:
    """FR-EV-001: Check patient eligibility with Redis caching."""
    agent = EligibilityAgent()
    claim = FHIRClaimBundle(
        hcx_sender_code="api-caller",
        hcx_recipient_code=req.payer_id,
        hcx_correlation_id=_API_CALL_ID,
        hcx_workflow_id="direct",
        hcx_api_call_id="direct",
        claim_id="api-check",
        claim_type=req.claim_type,
        patient_id=req.patient_id,
        provider_id=req.provider_id,
        payer_id=req.payer_id,
        total_amount=0.0,
        claim_date=req.service_date,
        service_date=req.service_date,
        clinical_notes=None,
    )
    return await agent.verify(claim)


@router.post("/coding/validate", response_model=CodingValidationResult)
async def validate_coding(
    req: CodingValidateRequest,
    _: str = Depends(verify_service_jwt),
) -> CodingValidationResult:
    """FR-MC-001: Validate ICD-10 codes and extract clinical entities."""
    agent = MedicalCodingAgent()
    now = _now()
    claim = FHIRClaimBundle(
        hcx_sender_code="api-caller",
        hcx_recipient_code="direct",
        hcx_correlation_id=_API_CALL_ID,
        hcx_workflow_id="direct",
        hcx_api_call_id="direct",
        claim_id="api-check",
        claim_type=req.claim_type,
        patient_id=_API_PATIENT_PLACEHOLDER,
        provider_id="api-check",
        payer_id="api-check",
        diagnosis_codes=req.diagnosis_codes,
        procedure_codes=req.procedure_codes,
        drug_codes=req.drug_codes,
        clinical_notes=req.clinical_notes,
        prescription_id=req.prescription_id,
        total_amount=0.0,
        claim_date=now,
        service_date=now,
    )
    return await agent.validate(claim)


@router.post("/fraud/score", response_model=FraudDetectionResult)
async def score_fraud(
    req: FraudScoreRequest,
    _: str = Depends(verify_service_jwt),
) -> FraudDetectionResult:
    """FR-FD-001: Score claim for fraud risk using ensemble ML models."""
    agent = FraudDetectionAgent()
    claim = FHIRClaimBundle(
        hcx_sender_code="api-caller",
        hcx_recipient_code="direct",
        hcx_correlation_id=f"{_API_CALL_ID}:{req.claim_id}",
        hcx_workflow_id="direct",
        hcx_api_call_id="direct",
        claim_id=req.claim_id,
        claim_type=req.claim_type,
        patient_id=req.patient_id,
        provider_id=req.provider_id,
        payer_id="api-check",
        diagnosis_codes=req.diagnosis_codes,
        procedure_codes=req.procedure_codes,
        total_amount=req.total_amount,
        claim_date=req.claim_date,
        service_date=req.service_date,
        clinical_notes=None,
    )
    return await agent.score(claim)


@router.post("/necessity/assess", response_model=MedicalNecessityResult)
async def assess_necessity(
    req: NecessityAssessRequest,
    _: str = Depends(verify_service_jwt),
) -> MedicalNecessityResult:
    """FR-MN-001: Assess medical necessity using MedGemma + EDA RAG."""
    agent = MedicalNecessityAgent()
    now = _now()
    claim = FHIRClaimBundle(
        hcx_sender_code="api-caller",
        hcx_recipient_code="direct",
        hcx_correlation_id=_API_CALL_ID,
        hcx_workflow_id="direct",
        hcx_api_call_id="direct",
        claim_id="api-check",
        claim_type=req.claim_type,
        patient_id=_API_PATIENT_PLACEHOLDER,
        provider_id="api-check",
        payer_id="api-check",
        diagnosis_codes=req.diagnosis_codes,
        procedure_codes=req.procedure_codes,
        drug_codes=req.drug_codes,
        clinical_notes=req.clinical_notes,
        total_amount=req.total_amount,
        claim_date=now,
        service_date=now,
    )
    return await agent.assess(claim)
