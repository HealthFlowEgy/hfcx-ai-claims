"""
Pytest fixtures for HFCX AI Claims test suite.
Uses testcontainers-python for integration tests (SRS Section 9).
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import datetime

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient

from src.main import create_app
from src.models.schemas import ClaimType, FHIRClaimBundle

# ─────────────────────────────────────────────────────────────────────────────
# Sample FHIR Claim fixture (Egyptian healthcare context)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_claim() -> FHIRClaimBundle:
    return FHIRClaimBundle(
        hcx_sender_code="PROVIDER-EG-001",
        hcx_recipient_code="PAYER-EG-MISR",
        hcx_correlation_id="test-correlation-001",
        hcx_workflow_id="wf-test-001",
        hcx_api_call_id="api-call-001",
        claim_id="CLAIM-EG-2026-001",
        claim_type=ClaimType.OUTPATIENT,
        patient_id="29901011234567",          # Valid Egyptian National ID format
        provider_id="HCP-EG-KASR-001",
        payer_id="MISR-INSURANCE-001",
        diagnosis_codes=["J06.9", "Z00.00"],  # Upper respiratory + wellness
        procedure_codes=["99213"],             # Office visit, established patient
        total_amount=850.0,                    # EGP
        claim_date=datetime(2026, 4, 1, 10, 0, 0),
        service_date=datetime(2026, 4, 1, 9, 0, 0),
        drug_codes=["EDA-12345"],
        clinical_notes="مريض يشكو من ارتفاع في درجة الحرارة وألم في الحلق.",
    )


@pytest.fixture
def high_value_suspicious_claim() -> FHIRClaimBundle:
    """Claim designed to trigger fraud detection rules."""
    return FHIRClaimBundle(
        hcx_sender_code="PROVIDER-EG-002",
        hcx_recipient_code="PAYER-EG-ALLIANZ",
        hcx_correlation_id="test-fraud-001",
        hcx_workflow_id="wf-fraud-001",
        hcx_api_call_id="api-call-fraud-001",
        claim_id="CLAIM-EG-FRAUD-001",
        claim_type=ClaimType.OUTPATIENT,
        patient_id="29901011234568",
        provider_id="HCP-EG-SUSPECT-001",
        payer_id="ALLIANZ-EG-001",
        diagnosis_codes=["Z00.00", "Z00.01", "Z01.00", "Z01.01", "Z02.00",
                          "Z02.01", "Z03.00", "Z03.01", "Z04.00", "Z04.01", "Z05.00"],
        procedure_codes=["99213", "99215", "99201"],
        total_amount=75_000.0,                # Very high for outpatient
        claim_date=datetime(2026, 4, 1),
        service_date=datetime(2025, 12, 1),  # 4-month lag
        drug_codes=[],
        clinical_notes=None,                  # Missing notes for high-value claim
    )


@pytest.fixture
def pharmacy_claim() -> FHIRClaimBundle:
    return FHIRClaimBundle(
        hcx_sender_code="PHARMA-EG-001",
        hcx_recipient_code="PAYER-EG-MISR",
        hcx_correlation_id="test-pharma-001",
        hcx_workflow_id="wf-pharma-001",
        hcx_api_call_id="api-call-pharma-001",
        claim_id="CLAIM-PHARMA-2026-001",
        claim_type=ClaimType.PHARMACY,
        patient_id="29901011234567",
        provider_id="PHARMA-EG-CAIRO-001",
        payer_id="MISR-INSURANCE-001",
        diagnosis_codes=["E11.9"],           # Type 2 diabetes
        procedure_codes=[],
        total_amount=1250.0,
        claim_date=datetime(2026, 4, 1),
        service_date=datetime(2026, 4, 1),
        drug_codes=["EDA-METFORMIN-500", "EDA-GLIPIZIDE-5"],
        prescription_id="RX-EG-2026-001",
        clinical_notes="Routine diabetes medication refill.",
    )


@pytest.fixture
def raw_fhir_bundle(sample_claim: FHIRClaimBundle) -> dict:
    """Minimal valid FHIR R4 Bundle containing a Claim resource."""
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
            {
                "resource": {
                    "resourceType": "Claim",
                    "id": sample_claim.claim_id,
                    "type": {"coding": [{"code": "professional"}]},
                    "patient": {"reference": f"Patient/{sample_claim.patient_id}"},
                    "provider": {"reference": f"Organization/{sample_claim.provider_id}"},
                    "insurance": [{"coverage": {"reference": f"Coverage/{sample_claim.payer_id}"}}],
                    "created": sample_claim.claim_date.isoformat(),
                    "diagnosis": [
                        {
                            "sequence": i + 1,
                            "diagnosisCodeableConcept": {
                                "coding": [{"code": code, "system": "http://hl7.org/fhir/sid/icd-10"}]
                            }
                        }
                        for i, code in enumerate(sample_claim.diagnosis_codes)
                    ],
                    "total": {"value": sample_claim.total_amount, "currency": "EGP"},
                    "item": [
                        {
                            "sequence": 1,
                            "servicedDate": sample_claim.service_date.date().isoformat(),
                            "productOrService": {"coding": [{"code": "99213"}]},
                        }
                    ],
                    "supportingInfo": [
                        {
                            "sequence": 1,
                            "category": {"coding": [{"code": "clinicalnotes"}]},
                            "valueString": sample_claim.clinical_notes,
                        }
                    ] if sample_claim.clinical_notes else [],
                }
            }
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI test client
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    app = create_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client


@pytest.fixture
def sync_client():
    app = create_app()
    with TestClient(app) as client:
        yield client
