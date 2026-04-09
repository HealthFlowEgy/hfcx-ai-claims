"""
FHIR R4 Claim Bundle Parser
Extracts structured fields from raw FHIR JSON for AI agent consumption.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog

from src.models.schemas import ClaimType, FHIRClaimBundle

log = structlog.get_logger(__name__)

CLAIM_TYPE_MAP = {
    "professional": ClaimType.OUTPATIENT,
    "institutional": ClaimType.INPATIENT,
    "pharmacy": ClaimType.PHARMACY,
    "oral": ClaimType.DENTAL,
    "vision": ClaimType.VISION,
}


class FHIRClaimParser:
    """
    Parses FHIR R4 Claim resource bundles from hcx-pipeline-jobs.
    Handles both the full Bundle resource and bare Claim resource formats.
    """

    def parse(self, raw_bundle: dict[str, Any], hcx_headers: dict[str, str]) -> FHIRClaimBundle:
        # Extract the Claim resource from Bundle or use directly
        claim_resource = self._extract_claim_resource(raw_bundle)

        return FHIRClaimBundle(
            # HCX Protocol Headers
            hcx_sender_code=hcx_headers.get("X-HCX-Sender-Code", ""),
            hcx_recipient_code=hcx_headers.get("X-HCX-Recipient-Code", ""),
            hcx_correlation_id=hcx_headers.get("X-HCX-Correlation-ID", ""),
            hcx_workflow_id=hcx_headers.get("X-HCX-Workflow-ID", ""),
            hcx_api_call_id=hcx_headers.get("X-HCX-API-Call-ID", ""),

            # FHIR Claim fields
            claim_id=claim_resource.get("id", ""),
            claim_type=self._parse_claim_type(claim_resource),
            patient_id=self._extract_patient_id(claim_resource),
            provider_id=self._extract_provider_id(claim_resource),
            payer_id=self._extract_payer_id(claim_resource),
            diagnosis_codes=self._extract_diagnosis_codes(claim_resource),
            procedure_codes=self._extract_procedure_codes(claim_resource),
            total_amount=self._extract_total_amount(claim_resource),
            claim_date=self._parse_datetime(claim_resource.get("created")),
            service_date=self._extract_service_date(claim_resource),
            drug_codes=self._extract_drug_codes(claim_resource),
            prescription_id=self._extract_prescription_id(claim_resource),
            attachment_ids=self._extract_attachment_ids(claim_resource),
            clinical_notes=self._extract_clinical_notes(claim_resource),
            raw_fhir_bundle=raw_bundle,
        )

    def _extract_claim_resource(self, bundle: dict[str, Any]) -> dict[str, Any]:
        if bundle.get("resourceType") == "Bundle":
            for entry in bundle.get("entry", []):
                resource = entry.get("resource", {})
                if resource.get("resourceType") == "Claim":
                    return resource
        elif bundle.get("resourceType") == "Claim":
            return bundle
        return bundle

    def _parse_claim_type(self, claim: dict) -> ClaimType:
        type_code = (
            claim.get("type", {})
            .get("coding", [{}])[0]
            .get("code", "professional")
            .lower()
        )
        return CLAIM_TYPE_MAP.get(type_code, ClaimType.OUTPATIENT)

    def _extract_patient_id(self, claim: dict) -> str:
        patient_ref = claim.get("patient", {}).get("reference", "")
        return patient_ref.split("/")[-1] if "/" in patient_ref else patient_ref

    def _extract_provider_id(self, claim: dict) -> str:
        provider_ref = claim.get("provider", {}).get("reference", "")
        return provider_ref.split("/")[-1] if "/" in provider_ref else provider_ref

    def _extract_payer_id(self, claim: dict) -> str:
        insurers = claim.get("insurance", [])
        if insurers:
            ref = insurers[0].get("coverage", {}).get("reference", "")
            return ref.split("/")[-1] if "/" in ref else ref
        return ""

    def _extract_diagnosis_codes(self, claim: dict) -> list[str]:
        codes = []
        for dx in claim.get("diagnosis", []):
            coding = dx.get("diagnosisCodeableConcept", {}).get("coding", [])
            for c in coding:
                if code := c.get("code"):
                    codes.append(code)
        return codes

    def _extract_procedure_codes(self, claim: dict) -> list[str]:
        codes = []
        for proc in claim.get("procedure", []):
            coding = proc.get("procedureCodeableConcept", {}).get("coding", [])
            for c in coding:
                if code := c.get("code"):
                    codes.append(code)
        return codes

    # Known drug code systems: EDA formulary, RxNorm, SNOMED medication,
    # ATC, NDC, plus FHIR's generic "medication" convention.
    _DRUG_SYSTEM_MARKERS = (
        "eda.gov.eg",
        "rxnorm",
        "medication",
        "atc",
        "ndc",
    )

    def _extract_drug_codes(self, claim: dict) -> list[str]:
        """Extract drug/medication codes from Claim.item for pharmacy claims."""
        codes: list[str] = []
        for item in claim.get("item", []):
            coding = item.get("productOrService", {}).get("coding", [])
            for c in coding:
                system = (c.get("system") or "").lower()
                code = c.get("code")
                if code and any(marker in system for marker in self._DRUG_SYSTEM_MARKERS):
                    codes.append(code)
        return codes

    def _extract_total_amount(self, claim: dict) -> float:
        total = claim.get("total", {})
        return float(total.get("value", 0.0))

    def _extract_service_date(self, claim: dict) -> datetime:
        for item in claim.get("item", []):
            if service_date := item.get("servicedDate"):
                return self._parse_datetime(service_date)
        return datetime.now(UTC)

    def _extract_prescription_id(self, claim: dict) -> str | None:
        for ref in claim.get("prescription", []):
            if r := ref.get("reference"):
                return r.split("/")[-1]
        return None

    def _extract_attachment_ids(self, claim: dict) -> list[str]:
        """Extract MinIO object IDs from SupportingInfo attachments."""
        ids = []
        for info in claim.get("supportingInfo", []):
            if url := info.get("valueAttachment", {}).get("url"):
                # MinIO URL format: minio://claim-documents/{object-id}
                ids.append(url.split("/")[-1])
        return ids

    def _extract_clinical_notes(self, claim: dict) -> str | None:
        """Extract free-text clinical notes from SupportingInfo."""
        for info in claim.get("supportingInfo", []):
            category = (
                info.get("category", {})
                    .get("coding", [{}])[0]
                    .get("code", "")
            )
            if category == "clinicalnotes":
                return info.get("valueString")
        return None

    def _parse_datetime(self, value: str | None) -> datetime:
        if not value:
            return datetime.now(UTC)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(UTC)
