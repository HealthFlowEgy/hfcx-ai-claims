#!/usr/bin/env python3
"""
Egyptian Healthcare Claims Test Data Generator (SRS Section 2.4)

Generates realistic synthetic claims for:
  - Unit testing (fast, in-memory)
  - Integration testing (Kafka injection)
  - Load testing (k6 scripts)
  - ML model training data (fraud detection Phase 1 warmup)

Uses Faker + Mimesis for Egyptian-specific data (SRS 2.4 — replaces P1's custom generator).
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta
from typing import Any

from faker import Faker
from faker.providers import BaseProvider

# Egyptian locale
fake = Faker(["ar_EG", "en_US"])

# ─────────────────────────────────────────────────────────────────────────────
# Egyptian Healthcare Data
# ─────────────────────────────────────────────────────────────────────────────

EGYPTIAN_ICD10_COMMON = [
    ("J06.9", "Acute upper respiratory infection"),
    ("E11.9", "Type 2 diabetes mellitus"),
    ("I10", "Essential hypertension"),
    ("K21.0", "Gastroesophageal reflux with oesophagitis"),
    ("M54.5", "Low back pain"),
    ("F41.1", "Generalized anxiety disorder"),
    ("J18.9", "Pneumonia, unspecified"),
    ("N39.0", "Urinary tract infection"),
    ("L50.0", "Allergic urticaria"),
    ("H10.3", "Acute conjunctivitis"),
    ("G43.9", "Migraine"),
    ("B34.9", "Viral infection, unspecified"),
]

EGYPTIAN_PROVIDERS = [f"HCP-EG-{city}-{i:03d}" for city in
                       ["CAIRO", "ALEX", "GIZA", "LUXOR", "ASWAN"] for i in range(1, 21)]

EGYPTIAN_PAYERS = [
    "MISR-INSURANCE-001",
    "ALLIANZ-EG-001",
    "AXA-EG-001",
    "MOHANDES-INS-001",
    "DELTA-INS-001",
    "BUPA-EG-001",
]

EDA_DRUG_CODES = [
    "EDA-METFORMIN-500", "EDA-AMOXICILLIN-500", "EDA-ATORVASTATIN-20",
    "EDA-OMEPRAZOLE-20", "EDA-AMLODIPINE-5", "EDA-PARACETAMOL-500",
    "EDA-IBUPROFEN-400", "EDA-LISINOPRIL-10", "EDA-GLIPIZIDE-5",
    "EDA-AZITHROMYCIN-500",
]

CPT_PROCEDURES = ["99213", "99214", "99203", "99232", "99291", "93000", "71046", "80053"]


def generate_national_id() -> str:
    """Generate a syntactically valid Egyptian National ID (14 digits)."""
    century = random.choice(["2", "3"])   # 2=1900s, 3=2000s
    year = random.randint(60, 99) if century == "2" else random.randint(0, 10)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    governorate = random.randint(1, 35)
    serial = random.randint(1000, 9999)
    check = random.randint(1, 9)
    return f"{century}{year:02d}{month:02d}{day:02d}{governorate:02d}{serial:04d}{check}"


def generate_claim(
    claim_type: str = "outpatient",
    fraud: bool = False,
    amount_override: float | None = None,
) -> dict[str, Any]:
    """Generate a single synthetic FHIR Claim bundle."""
    dx_count = random.randint(1, 3) if not fraud else random.randint(8, 12)
    diagnoses = random.sample(EGYPTIAN_ICD10_COMMON, min(dx_count, len(EGYPTIAN_ICD10_COMMON)))
    service_date = datetime.utcnow() - timedelta(days=random.randint(0, 30 if not fraud else 120))
    claim_date = service_date + timedelta(days=random.randint(0, 5 if not fraud else 95))

    # Amount ranges by type (EGP)
    if amount_override:
        amount = amount_override
    elif claim_type == "outpatient":
        amount = random.uniform(200, 2000) if not fraud else random.uniform(50000, 100000)
    elif claim_type == "inpatient":
        amount = random.uniform(5000, 50000)
    elif claim_type == "pharmacy":
        amount = random.uniform(100, 3000)
    else:
        amount = random.uniform(500, 10000)

    claim_id = f"CLAIM-EG-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    patient_id = generate_national_id()
    provider_id = random.choice(EGYPTIAN_PROVIDERS)
    payer_id = random.choice(EGYPTIAN_PAYERS)
    correlation_id = str(uuid.uuid4())

    # Clinical notes (Arabic/English mix)
    arabic_notes = random.choice([
        "مريض يشكو من ارتفاع في درجة الحرارة وألم في الحلق.",
        "المريض يعاني من آلام في الظهر منذ أسبوعين.",
        "مراجعة دورية لمريض السكري، الهيموجلوبين الغليكوزيلاتي مستقر.",
        "المريض يشكو من صداع متكرر وغثيان.",
        None,  # Sometimes no notes
    ])

    fhir_bundle = {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{
            "resource": {
                "resourceType": "Claim",
                "id": claim_id,
                "type": {"coding": [{"code": claim_type}]},
                "patient": {"reference": f"Patient/{patient_id}"},
                "provider": {"reference": f"Organization/{provider_id}"},
                "insurance": [{"coverage": {"reference": f"Coverage/{payer_id}"}}],
                "created": claim_date.isoformat(),
                "diagnosis": [
                    {
                        "sequence": i + 1,
                        "diagnosisCodeableConcept": {
                            "coding": [{"code": dx[0], "system": "http://hl7.org/fhir/sid/icd-10",
                                        "display": dx[1]}]
                        }
                    }
                    for i, dx in enumerate(diagnoses)
                ],
                "procedure": [
                    {
                        "sequence": 1,
                        "procedureCodeableConcept": {
                            "coding": [{"code": random.choice(CPT_PROCEDURES)}]
                        }
                    }
                ],
                "total": {"value": round(amount, 2), "currency": "EGP"},
                "item": [{"sequence": 1, "servicedDate": service_date.date().isoformat(),
                           "productOrService": {"coding": [{"code": random.choice(CPT_PROCEDURES)}]}}],
                "supportingInfo": [
                    {"sequence": 1, "category": {"coding": [{"code": "clinicalnotes"}]},
                     "valueString": arabic_notes}
                ] if arabic_notes else [],
            }
        }]
    }

    return {
        "event_type": "ClaimReceived",
        "schema_version": "1.0",
        "timestamp": datetime.utcnow().isoformat(),
        "payload": fhir_bundle,
        "hcx_headers": {
            "X-HCX-Sender-Code": provider_id,
            "X-HCX-Recipient-Code": payer_id,
            "X-HCX-Correlation-ID": correlation_id,
            "X-HCX-Workflow-ID": str(uuid.uuid4()),
            "X-HCX-API-Call-ID": str(uuid.uuid4()),
        }
    }


def generate_dataset(
    n_normal: int = 1000,
    n_fraud: int = 50,
    output_file: str = "test_claims.jsonl",
) -> None:
    """Generate a labeled dataset for fraud model training."""
    print(f"Generating {n_normal} normal + {n_fraud} fraudulent claims...")
    with open(output_file, "w", encoding="utf-8") as f:
        for _ in range(n_normal):
            claim = generate_claim(
                claim_type=random.choice(["outpatient", "inpatient", "pharmacy"]),
                fraud=False,
            )
            claim["label"] = 0  # Not fraud
            f.write(json.dumps(claim, ensure_ascii=False) + "\n")

        for _ in range(n_fraud):
            claim = generate_claim(
                claim_type=random.choice(["outpatient", "pharmacy"]),
                fraud=True,
            )
            claim["label"] = 1  # Fraud
            f.write(json.dumps(claim, ensure_ascii=False) + "\n")

    print(f"✓ Written to {output_file}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--normal", type=int, default=1000)
    parser.add_argument("--fraud", type=int, default=50)
    parser.add_argument("--output", default="test_claims.jsonl")
    parser.add_argument("--single", action="store_true", help="Print one claim as JSON")
    args = parser.parse_args()

    if args.single:
        print(json.dumps(generate_claim(), indent=2, ensure_ascii=False))
    else:
        generate_dataset(args.normal, args.fraud, args.output)
