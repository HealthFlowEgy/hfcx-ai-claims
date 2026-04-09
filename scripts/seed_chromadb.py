#!/usr/bin/env python3
"""
Seed ChromaDB with EDA Egyptian Drug Authority formulary data.

This script populates the vector store used by the Medical Necessity Agent (RAG).
In production: run once during Phase 0 infrastructure setup (SRS Appendix C).

Usage:
    python scripts/seed_chromadb.py --eda-csv /path/to/eda_formulary.csv
    python scripts/seed_chromadb.py --demo   # Seed with synthetic demo data

Data sources:
    - EDA formulary: 47,292 drug codes (obtained from EDA official database)
    - Egyptian clinical guidelines: MOH / NHIA policy documents (PDF → text)
    - Arabic drug descriptions: from EDA Arabic formulary portal
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import get_settings

settings = get_settings()

# Use nomic-embed-text via Ollama for embeddings (same model used in production)
EMBEDDING_FUNCTION = embedding_functions.OllamaEmbeddingFunction(
    url=f"http://localhost:11434/api/embeddings",
    model_name="nomic-embed-text",
)

# Synthetic EDA formulary entries for demo/testing
DEMO_EDA_ENTRIES = [
    {
        "id": "EDA-METFORMIN-500",
        "text": "Metformin Hydrochloride 500mg tablets. Indicated for Type 2 Diabetes Mellitus (E11). "
                "مثفورمين هيدروكلوريد ٥٠٠ ملجم أقراص. يُستخدم لعلاج داء السكري من النوع الثاني.",
        "metadata": {
            "eda_code": "EDA-METFORMIN-500",
            "generic_name": "Metformin HCl",
            "indication_icd10": "E11.9",
            "formulary_status": "listed",
            "tier": "1",
            "requires_prior_auth": False,
            "arabic_name": "ميتفورمين",
        }
    },
    {
        "id": "EDA-AMOXICILLIN-500",
        "text": "Amoxicillin 500mg capsules. Indicated for bacterial infections including J06.9 (URTI), "
                "J22 (LRTI), J01 (Sinusitis). First-line antibiotic per MOH Antibiotic Stewardship Guidelines. "
                "أموكسيسيلين ٥٠٠ ملجم كبسول. يُستخدم للعدوى البكتيرية.",
        "metadata": {
            "eda_code": "EDA-AMOXICILLIN-500",
            "generic_name": "Amoxicillin",
            "indication_icd10": "J06.9,J22,J01",
            "formulary_status": "listed",
            "tier": "1",
            "requires_prior_auth": False,
            "arabic_name": "أموكسيسيلين",
        }
    },
    {
        "id": "EDA-ATORVASTATIN-20",
        "text": "Atorvastatin 20mg tablets. Indicated for Hyperlipidemia (E78), Coronary artery disease (I25). "
                "Second-line statin; Simvastatin preferred first-line per NHIA policy. "
                "أتورفاستاتين ٢٠ ملجم أقراص. يُستخدم لعلاج ارتفاع الكوليسترول.",
        "metadata": {
            "eda_code": "EDA-ATORVASTATIN-20",
            "generic_name": "Atorvastatin",
            "indication_icd10": "E78,I25",
            "formulary_status": "listed",
            "tier": "2",
            "requires_prior_auth": False,
            "arabic_name": "أتورفاستاتين",
        }
    },
    {
        "id": "EDA-ADALIMUMAB-40",
        "text": "Adalimumab 40mg injection. Biologic agent for Rheumatoid Arthritis (M05), "
                "Crohn's Disease (K50), Psoriasis (L40). Requires prior authorization from NHIA. "
                "NHIA policy: must fail 2 DMARDs before approval. "
                "أداليموماب ٤٠ ملجم حقن. علاج بيولوجي يستلزم موافقة مسبقة.",
        "metadata": {
            "eda_code": "EDA-ADALIMUMAB-40",
            "generic_name": "Adalimumab",
            "indication_icd10": "M05,K50,L40",
            "formulary_status": "restricted",
            "tier": "4",
            "requires_prior_auth": True,
            "prior_auth_criteria": "Failure of 2 conventional DMARDs",
            "arabic_name": "أداليموماب",
        }
    },
    {
        "id": "EDA-LECANEMAB-10",
        "text": "Lecanemab 10mg/mL infusion. Indicated for Early Alzheimer's Disease (G30). "
                "NOT listed in Egyptian EDA formulary as of Q1 2026. Import requires special permit. "
                "ليكانيماب: غير مدرج في قائمة الأدوية المصرية حتى الآن.",
        "metadata": {
            "eda_code": "EDA-LECANEMAB-10",
            "generic_name": "Lecanemab",
            "indication_icd10": "G30",
            "formulary_status": "unlisted",
            "tier": "5",
            "requires_prior_auth": True,
            "arabic_name": "ليكانيماب",
        }
    },
]

DEMO_GUIDELINES_ENTRIES = [
    {
        "id": "GL-NHIA-OUTPATIENT-2024",
        "text": "NHIA Outpatient Coverage Policy 2024: All outpatient visits covered at HCP-registered facilities. "
                "Copay: 10% for Tier 1 drugs, 20% for Tier 2, 30% for Tier 3. "
                "Referral required for specialist visits. Maximum 12 outpatient visits per year per beneficiary. "
                "سياسة التغطية الخارجية للهيئة الوطنية للتأمين الصحي ٢٠٢٤.",
        "metadata": {
            "source": "NHIA",
            "policy_id": "NHIA-OP-2024",
            "effective_date": "2024-01-01",
            "claim_types": "outpatient",
        }
    },
    {
        "id": "GL-MOH-ANTIBIOTIC-2023",
        "text": "Egyptian Ministry of Health Antibiotic Stewardship Guidelines 2023: "
                "Amoxicillin first-line for community-acquired URTI (J06.9). "
                "Azithromycin for penicillin-allergic patients. "
                "Duration: 5-7 days for URTI, 7-10 days for pneumonia (J18). "
                "Culture required before IV antibiotics exceeding 3 days. "
                "إرشادات وزارة الصحة المصرية للاستخدام الرشيد للمضادات الحيوية.",
        "metadata": {
            "source": "MOH",
            "guideline_id": "MOH-ABX-2023",
            "effective_date": "2023-06-01",
            "specialty": "infectious_disease",
        }
    },
    {
        "id": "GL-NHIA-DIABETES-2024",
        "text": "NHIA Diabetes Management Protocol 2024: Metformin first-line for T2DM (E11). "
                "HbA1c testing covered every 3 months. Insulin requires endocrinologist referral. "
                "Self-monitoring devices covered for insulin-dependent patients only. "
                "SGLT2 inhibitors require prior auth and confirmed CVD diagnosis. "
                "بروتوكول إدارة السكري للهيئة الوطنية للتأمين الصحي.",
        "metadata": {
            "source": "NHIA",
            "guideline_id": "NHIA-DM-2024",
            "effective_date": "2024-03-01",
            "specialty": "endocrinology",
            "icd10_codes": "E11,E10",
        }
    },
]


def seed_collection(
    client: chromadb.ClientAPI,
    collection_name: str,
    entries: list[dict],
    batch_size: int = 50,
) -> None:
    print(f"\n→ Seeding collection: {collection_name}")
    collection = client.get_or_create_collection(
        name=collection_name,
        embedding_function=EMBEDDING_FUNCTION,
        metadata={"hnsw:space": "cosine"},
    )

    # Process in batches
    for i in range(0, len(entries), batch_size):
        batch = entries[i:i + batch_size]
        collection.upsert(
            ids=[e["id"] for e in batch],
            documents=[e["text"] for e in batch],
            metadatas=[e["metadata"] for e in batch],
        )
        print(f"  Upserted {min(i + batch_size, len(entries))}/{len(entries)} entries")

    count = collection.count()
    print(f"  ✓ Collection '{collection_name}' now has {count} documents")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ChromaDB for HFCX AI Claims")
    parser.add_argument("--demo", action="store_true", help="Use synthetic demo data")
    parser.add_argument("--eda-csv", type=str, help="Path to EDA formulary CSV file")
    parser.add_argument("--chroma-host", default=settings.chroma_host)
    parser.add_argument("--chroma-port", type=int, default=settings.chroma_port)
    args = parser.parse_args()

    print(f"Connecting to ChromaDB at {args.chroma_host}:{args.chroma_port}...")
    client = chromadb.HttpClient(host=args.chroma_host, port=args.chroma_port)

    if args.demo:
        print("Using DEMO synthetic data (not for production)")
        seed_collection(client, settings.chroma_collection_eda_formulary, DEMO_EDA_ENTRIES)
        seed_collection(client, settings.chroma_collection_clinical_guidelines, DEMO_GUIDELINES_ENTRIES)

    elif args.eda_csv:
        import csv
        entries = []
        with open(args.eda_csv, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                entries.append({
                    "id": row.get("eda_code", row.get("id")),
                    "text": f"{row.get('generic_name', '')} {row.get('description', '')} "
                            f"{row.get('indication', '')} {row.get('arabic_name', '')}",
                    "metadata": {k: v for k, v in row.items()},
                })
        print(f"Loaded {len(entries)} EDA entries from CSV")
        seed_collection(client, settings.chroma_collection_eda_formulary, entries)

    else:
        print("Error: specify --demo or --eda-csv")
        sys.exit(1)

    print("\n✓ ChromaDB seeding complete.")


if __name__ == "__main__":
    main()
