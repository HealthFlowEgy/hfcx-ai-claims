"""
ChromaDB Auto-Seeder — Ensures clinical guidelines exist on startup.

Called during FastAPI lifespan startup. Checks if the clinical_guidelines
and eda_formulary collections are empty and seeds them with demo data
if they have zero documents. Uses ChromaDB's default embedding function
(all-MiniLM-L6-v2) to match the MedicalNecessityAgent query-time config.

This is idempotent: upsert ensures no duplicates on repeated restarts.
"""
from __future__ import annotations

import asyncio

import chromadb
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()

# ── Demo clinical guidelines (same data as scripts/seed_chromadb.py) ────
# These cover the ICD-10 codes that appear in live claim data.

DEMO_EDA_ENTRIES = [
    {
        "id": "EDA-METFORMIN-500",
        "text": (
            "Metformin Hydrochloride 500mg tablets. Indicated for "
            "Type 2 Diabetes Mellitus (E11). First-line oral "
            "hypoglycemic per NHIA protocol."
        ),
        "metadata": {
            "eda_code": "EDA-METFORMIN-500",
            "generic_name": "Metformin HCl",
            "indication_icd10": "E11.9",
            "formulary_status": "listed",
            "tier": "1",
        },
    },
    {
        "id": "EDA-AMOXICILLIN-500",
        "text": (
            "Amoxicillin 500mg capsules. Indicated for bacterial "
            "infections including J06.9 (URTI), J22 (LRTI), "
            "J01 (Sinusitis). First-line antibiotic per MOH "
            "Antibiotic Stewardship Guidelines."
        ),
        "metadata": {
            "eda_code": "EDA-AMOXICILLIN-500",
            "generic_name": "Amoxicillin",
            "indication_icd10": "J06.9,J22,J01",
            "formulary_status": "listed",
            "tier": "1",
        },
    },
    {
        "id": "EDA-ATORVASTATIN-20",
        "text": (
            "Atorvastatin 20mg tablets. Indicated for "
            "Hyperlipidemia (E78), Coronary artery disease (I25). "
            "Second-line statin; Simvastatin preferred first-line."
        ),
        "metadata": {
            "eda_code": "EDA-ATORVASTATIN-20",
            "generic_name": "Atorvastatin",
            "indication_icd10": "E78,I25",
            "formulary_status": "listed",
            "tier": "2",
        },
    },
    {
        "id": "EDA-ADALIMUMAB-40",
        "text": (
            "Adalimumab 40mg injection. Biologic agent for "
            "Rheumatoid Arthritis (M05), Crohn's Disease (K50), "
            "Psoriasis (L40). Requires prior authorization. "
            "Must fail 2 DMARDs before approval."
        ),
        "metadata": {
            "eda_code": "EDA-ADALIMUMAB-40",
            "generic_name": "Adalimumab",
            "indication_icd10": "M05,K50,L40",
            "formulary_status": "restricted",
            "tier": "4",
        },
    },
    {
        "id": "EDA-ORS-SACHETS",
        "text": (
            "Oral Rehydration Salts (ORS) sachets. Indicated for "
            "dehydration due to cholera (A00), acute diarrhea "
            "(A09), gastroenteritis. First-line rehydration therapy."
        ),
        "metadata": {
            "eda_code": "EDA-ORS-001",
            "generic_name": "ORS",
            "indication_icd10": "A00,A09",
            "formulary_status": "listed",
            "tier": "1",
        },
    },
]

DEMO_GUIDELINES_ENTRIES = [
    {
        "id": "GL-NHIA-OUTPATIENT-2024",
        "text": (
            "NHIA Outpatient Coverage Policy 2024: All outpatient "
            "visits covered at HCP-registered facilities. "
            "Copay: 10% for Tier 1 drugs, 20% for Tier 2, 30% "
            "for Tier 3. Referral required for specialist visits. "
            "Maximum 12 outpatient visits per year per beneficiary."
        ),
        "metadata": {
            "source": "NHIA",
            "policy_id": "NHIA-OP-2024",
            "effective_date": "2024-01-01",
            "claim_types": "outpatient",
        },
    },
    {
        "id": "GL-NHIA-INPATIENT-2024",
        "text": (
            "NHIA Inpatient Coverage Policy 2024: Inpatient "
            "admissions require pre-authorization for elective "
            "procedures. Emergency admissions covered without "
            "prior auth. Maximum length of stay: 30 days per "
            "episode. ICU coverage limited to 14 days."
        ),
        "metadata": {
            "source": "NHIA",
            "policy_id": "NHIA-IP-2024",
            "effective_date": "2024-01-01",
            "claim_types": "inpatient",
        },
    },
    {
        "id": "GL-MOH-CHOLERA-2024",
        "text": (
            "Egyptian MOH Cholera Management Protocol 2024 (A00): "
            "Cholera (A00.0 biovar cholerae, A00.1 biovar eltor, "
            "A00.9 unspecified) is a notifiable disease. Immediate "
            "oral rehydration therapy (ORT) is first-line. IV "
            "fluids for severe dehydration. Doxycycline or "
            "azithromycin for moderate-severe cases. Stool culture "
            "mandatory. Isolation and contact tracing required."
        ),
        "metadata": {
            "source": "MOH",
            "guideline_id": "MOH-CHOLERA-2024",
            "effective_date": "2024-01-01",
            "specialty": "infectious_disease",
            "icd10_codes": "A00,A00.0,A00.1,A00.9",
        },
    },
    {
        "id": "GL-MOH-ANTIBIOTIC-2023",
        "text": (
            "Egyptian MOH Antibiotic Stewardship Guidelines 2023: "
            "Amoxicillin first-line for community-acquired URTI "
            "(J06.9). Azithromycin for penicillin-allergic. "
            "Duration: 5-7 days for URTI, 7-10 days for pneumonia "
            "(J18). Culture required before IV antibiotics "
            "exceeding 3 days."
        ),
        "metadata": {
            "source": "MOH",
            "guideline_id": "MOH-ABX-2023",
            "effective_date": "2023-06-01",
            "specialty": "infectious_disease",
            "icd10_codes": "J06,J18,J22,J01",
        },
    },
    {
        "id": "GL-NHIA-DIABETES-2024",
        "text": (
            "NHIA Diabetes Management Protocol 2024: Metformin "
            "first-line for T2DM (E11). HbA1c testing covered "
            "every 3 months. Insulin requires endocrinologist "
            "referral. Self-monitoring devices covered for "
            "insulin-dependent patients only. SGLT2 inhibitors "
            "require prior auth and confirmed CVD diagnosis."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-DM-2024",
            "effective_date": "2024-03-01",
            "specialty": "endocrinology",
            "icd10_codes": "E11,E10,E11.9,E10.9",
        },
    },
    {
        "id": "GL-NHIA-METABOLIC-2024",
        "text": (
            "NHIA Metabolic Syndrome Guidelines 2024 (E88): "
            "Metabolic syndrome (E88.81) and other metabolic "
            "disorders (E88.9) require comprehensive workup "
            "including fasting lipid panel, fasting glucose, "
            "HbA1c, and waist circumference. Lifestyle "
            "modification is first-line. Pharmacotherapy for "
            "individual components (statins for dyslipidemia, "
            "metformin for pre-diabetes)."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-METAB-2024",
            "effective_date": "2024-01-01",
            "specialty": "endocrinology",
            "icd10_codes": "E88,E88.81,E88.9",
        },
    },
    {
        "id": "GL-NHIA-HYPERTENSION-2024",
        "text": (
            "NHIA Hypertension Management Protocol 2024 (I10): "
            "Essential hypertension treatment starts with "
            "lifestyle modification. First-line: ACE inhibitors "
            "or ARBs. Second-line: calcium channel blockers. "
            "Thiazide diuretics for resistant hypertension. "
            "BP monitoring every 3 months. Target BP <140/90."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-HTN-2024",
            "effective_date": "2024-01-01",
            "specialty": "cardiology",
            "icd10_codes": "I10",
        },
    },
    {
        "id": "GL-NHIA-GERD-2024",
        "text": (
            "NHIA GERD Management Protocol 2024 (K21): "
            "Gastro-esophageal reflux disease (K21.0 with "
            "esophagitis, K21.9 without). First-line: PPI "
            "therapy (omeprazole 20mg) for 4-8 weeks. Step-down "
            "to H2 blockers for maintenance. Endoscopy covered "
            "after 8 weeks of failed PPI or alarm symptoms."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-GERD-2024",
            "effective_date": "2024-01-01",
            "specialty": "gastroenterology",
            "icd10_codes": "K21,K21.0,K21.9",
        },
    },
    {
        "id": "GL-NHIA-BACK-PAIN-2024",
        "text": (
            "NHIA Low Back Pain Management Protocol 2024 (M54): "
            "Dorsalgia (M54.5 low back pain, M54.9 unspecified). "
            "Conservative management first: NSAIDs, physical "
            "therapy (12 sessions covered). MRI only after 6 "
            "weeks of failed conservative treatment or red flag "
            "symptoms. Spinal injections require pain specialist."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-LBP-2024",
            "effective_date": "2024-01-01",
            "specialty": "orthopedics",
            "icd10_codes": "M54,M54.5,M54.9",
        },
    },
    {
        "id": "GL-NHIA-ASTHMA-2024",
        "text": (
            "NHIA Asthma Management Protocol 2024 (J45): "
            "Bronchial asthma stepwise therapy per GINA. "
            "Step 1: SABA as needed. Step 2: low-dose ICS. "
            "Step 3: ICS/LABA combination. Spirometry required "
            "for diagnosis. Peak flow monitoring covered."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-ASTHMA-2024",
            "effective_date": "2024-01-01",
            "specialty": "pulmonology",
            "icd10_codes": "J45,J45.20,J45.30,J45.40,J45.50",
        },
    },
    {
        "id": "GL-NHIA-PHARMACY-2024",
        "text": (
            "NHIA Pharmacy Benefits Policy 2024: Generic "
            "substitution mandatory unless brand-medically-"
            "necessary form is submitted. Maximum 90-day supply "
            "for chronic medications. Controlled substances "
            "limited to 30-day supply. EDA formulary compliance "
            "required. Off-formulary drugs require exception."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-PHARM-2024",
            "effective_date": "2024-01-01",
            "claim_types": "pharmacy",
        },
    },
    {
        "id": "GL-NHIA-CKD-2024",
        "text": (
            "NHIA Chronic Kidney Disease Protocol 2024 (N18): "
            "CKD staging per KDIGO. eGFR monitoring every 3-6 "
            "months. Dialysis covered for Stage 5 (eGFR <15). "
            "Fistula creation covered 6 months before anticipated "
            "dialysis. EPO therapy requires Hb <10 g/dL."
        ),
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-CKD-2024",
            "effective_date": "2024-01-01",
            "specialty": "nephrology",
            "icd10_codes": "N18,N18.1,N18.2,N18.3,N18.4,N18.5",
        },
    },
]


async def seed_chromadb_if_empty() -> None:
    """Check ChromaDB collections and seed with demo data if empty.

    This function is called during FastAPI lifespan startup. It is
    idempotent (uses upsert) and tolerates ChromaDB being unavailable.
    """
    try:
        client = chromadb.HttpClient(
            host=settings.chroma_host,
            port=settings.chroma_port,
        )
        # Quick connectivity check
        client.heartbeat()
    except Exception as exc:
        log.warning(
            "chromadb_seeder_skipped",
            reason="ChromaDB not reachable",
            error=str(exc),
        )
        return

    try:
        await _seed_collection_if_empty(
            client,
            settings.chroma_collection_clinical_guidelines,
            DEMO_GUIDELINES_ENTRIES,
        )
        await _seed_collection_if_empty(
            client,
            settings.chroma_collection_eda_formulary,
            DEMO_EDA_ENTRIES,
        )
    except Exception as exc:
        log.warning("chromadb_seeder_error", error=str(exc))


async def _seed_collection_if_empty(
    client: chromadb.ClientAPI,
    collection_name: str,
    entries: list[dict],
) -> None:
    """Seed a single collection if it has zero documents."""

    def _do_seed():
        collection = client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        count = collection.count()
        if count > 0:
            log.info(
                "chromadb_collection_ok",
                collection=collection_name,
                count=count,
            )
            return

        log.info(
            "chromadb_seeding",
            collection=collection_name,
            entries=len(entries),
        )
        collection.upsert(
            ids=[e["id"] for e in entries],
            documents=[e["text"] for e in entries],
            metadatas=[e["metadata"] for e in entries],
        )
        log.info(
            "chromadb_seeded",
            collection=collection_name,
            count=collection.count(),
        )

    await asyncio.to_thread(_do_seed)
