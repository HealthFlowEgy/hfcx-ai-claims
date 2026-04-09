# Open-Source AI/ML Models for Medical Claim Processing
## Landscape Analysis for HealthFlow HCX — Egypt

---

## Executive Summary

This research maps the available open-source AI/ML ecosystem to the six functional areas where HealthFlow's Healthcare Claims Exchange (HFCX) can deploy intelligent automation. For each area, we identify the most viable models, their readiness level, and Egypt-specific adaptation requirements. The analysis covers models that can be self-hosted — a requirement given CBE/FRA data sovereignty constraints.

---

## 1. Foundation Medical LLMs (The "Brain" of Each Agent)

These are the general-purpose medical reasoning models that would power the LangGraph agents in the AWS sample architecture.

### Tier 1: Production-Ready, Self-Hostable

| Model | Size | License | MedQA Score | VRAM Required | Why It Matters for HCX |
|-------|------|---------|-------------|---------------|------------------------|
| **MedGemma 27B** (Google) | 27B | Open (research + commercial) | 87.7% | ~24GB (A100) | Best small open model for medical reasoning. Multimodal variant handles medical images + EHR data. Retains non-English capabilities including Arabic |
| **OpenAI GPT-OSS-120B** | 117B (5.1B active, MoE) | Apache 2.0 | Near o4-mini level | Single 80GB GPU | MoE architecture means low inference cost despite huge parameter count. Full commercial use |
| **OpenAI GPT-OSS-20B** | 21B (3.6B active, MoE) | Apache 2.0 | Matches o3-mini | 16GB VRAM | Runs on consumer hardware. Viable for edge deployment at hospital/pharmacy endpoints |
| **Llama 3.1 405B** | 405B | Llama license | On par with GPT-4 on NEJM cases | Multi-GPU | Harvard/HMS study confirmed parity with GPT-4 on 92 diagnostically challenging NEJM cases |
| **Qwen 2.5 / Qwen 3** | 7B–72B | Apache 2.0 | Competitive | 8–48GB | Already used in the AWS sample repo (Qwen2.5-Coder:32B). Arabic tokenization is better than most Western models |

### Tier 2: Specialized Medical Fine-Tunes

| Model | Base | Focus | Availability |
|-------|------|-------|-------------|
| **BiMediX** (MBZUAI) | Mixtral 8x7B | Bilingual English-Arabic medical QA | CC-BY-NC-SA 4.0 on HuggingFace. 10+ points higher accuracy than Jais-30B on Arabic medical benchmarks |
| **MedSigLIP** (Google) | SigLIP | Medical image + text encoding for classification/search | Open, lightweight encoder |
| **ClinicalBERT** | BERT | Fine-tuned on MIMIC-III clinical notes | Open, widely deployed |
| **BioBERT** | BERT | Trained on PubMed + PMC biomedical corpora | Apache 2.0 |
| **PubMedBERT** | BERT | Pre-trained exclusively on PubMed abstracts | Open |

### Egypt-Specific Recommendation

**Primary agent LLM:** MedGemma 27B Text for claim adjudication reasoning. Its non-English retention means Arabic clinical notes won't degrade performance severely. Self-host on DigitalOcean GPU droplet or dedicated A100 instance.

**Arabic clinical NLP:** BiMediX for any Arabic text understanding tasks (patient notes, Arabic claim descriptions). Fine-tune on Egyptian clinical data if available from NHIA pilot sites.

**Lightweight edge model:** Qwen 3 7B or GPT-OSS-20B for pharmacy/clinic-level validation where full GPU infrastructure isn't available.

---

## 2. ICD-10 / Medical Coding Automation

This is critical for HCX — every claim needs accurate ICD-10 codes, and Egyptian clinical documentation quality varies dramatically between facilities.

### Available Approaches

**A. Fine-Tuned LLMs for ICD Coding**
- Recent research (npj Health Systems, May 2025) showed that fine-tuning Llama on 74,260 ICD-10 code-description pairs achieved **97% exact match** on standard descriptions and **69.2% exact match / 87.2% category match** on real clinical notes
- This is the most promising approach for HCX: fine-tune a small model (7–13B) on EDA's 47,292 registered medicines mapped to ICD-10 codes
- Open dataset: `putssander/icdllmeval` on GitHub provides evaluation framework

**B. NER + Entity Resolution Pipeline**
- John Snow Labs' Spark NLP for Healthcare: 50+ pretrained NER models covering ICD-10, RxNorm, SNOMED, UMLS, CPT-4. **76% ICD-10 accuracy** vs GPT-4's 36%
- **Note:** Spark NLP core is Apache 2.0 open source; Healthcare NLP is licensed (commercial). The open-source core can be used with custom-trained healthcare models
- Pipeline: Clinical text → NER extraction → SBERT embeddings → Entity resolution to ICD-10

**C. PLM-ICD (Pre-trained Language Model for ICD Coding)**
- Open-source PyTorch implementation on GitHub
- Multi-label text classification using BERT/RoBERTa fine-tuned for ICD coding
- Academic-grade but proven architecture

**D. Awesome Medical Coding NLP Collection**
- `acadTags/Awesome-medical-coding-NLP` on GitHub: curated list of 100+ papers and implementations
- Key highlighted approaches: Human-AI collaborative coding (npj Digital Medicine 2024), multi-agent ICD coding with LLMs, ClinicalMamba for longitudinal notes

### Egypt Adaptation

The core challenge: Egyptian clinical documentation is often in Arabic (or mixed Arabic-English), uses local terminology, and follows EDA-specific drug coding rather than US NDC codes. The recommended approach:

1. Start with MedGemma 27B or fine-tuned Llama for ICD-10 code suggestion
2. Build a RAG layer over EDA's drug formulary (47,292 medicines) to map local drug names → ATC codes → ICD-10 indications
3. Use the entity resolution pipeline pattern from Spark NLP but with custom Egyptian models trained on NHIA claims data

---

## 3. Healthcare Fraud Detection

This is HCX's unique value proposition — cross-payer fraud visibility. Available open-source tools and models:

### Production-Ready Frameworks

| Project | Approach | Data Source | Applicable to Egypt? |
|---------|----------|-------------|---------------------|
| **CMS Medicare Fraud Detection** (`Pyligent/CMS-Medicare-Data-FRAUD-Detection`) | Anomaly detection + supervised ML on Part D prescriber data | CMS public datasets | Architecture transferable; retrain on Egyptian claims data |
| **Healthcare Provider Fraud Detection** (`rohansoni634/Healthcare-Provider-Fraud-Detection-Analysis`) | XGBoost/Random Forest binary classification on provider-level features | Kaggle Medicare dataset | Good feature engineering template: claim duration, # physicians per claim, chronic conditions, geographic patterns |
| **Streamlit Fraud Detection App** (`sumeetshahu/Healthcare-Fraud-Detection`) | End-to-end web app with model serving | Inpatient + outpatient + beneficiary data | Deployable prototype pattern |

### Key Fraud Detection Features (Transferable to Egypt)

From the literature and open-source implementations, these features consistently predict healthcare fraud:

- **Provider-level aggregates:** Total claim amount per provider, number of unique patients, average claim duration, ratio of inpatient to outpatient claims
- **Beneficiary-level signals:** Number of chronic conditions, multiple providers for same condition, age/geographic anomalies
- **Claim-level patterns:** Diagnosis-procedure code mismatch, claim amount outliers, weekend/holiday submissions, duplicate claims within time window
- **Network analysis:** Provider-patient-physician graph clustering to detect organized fraud rings

### Egypt-Specific Fraud Patterns (Not in US Models)

HCX will need custom fraud models for:
- **Cross-payer duplicate claims:** Same patient, same service, submitted to multiple private insurers. Only detectable from HCX's exchange-wide view
- **Phantom pharmacy claims:** NDP prescription data can cross-validate against pharmacy claim submissions
- **Provider upcoding:** ICD-10 code severity inflation — compare expected diagnosis distribution per specialty against actual submissions
- **Eligibility fraud:** National ID validation against NHIA enrollment status

### Recommended Architecture

Use the AWS sample's LangGraph Fraud Agent pattern with these Egyptian-trained models:
1. **Anomaly detection model** (unsupervised) — train on first 6 months of HCX claims data using Isolation Forest or Autoencoder
2. **Supervised fraud classifier** (post-investigation labels) — XGBoost with the feature engineering patterns above
3. **Graph-based network analysis** — provider-patient-pharmacy relationship graphs using NetworkX or Neo4j
4. **LLM reasoning agent** — MedGemma for natural language explanation of fraud signals ("This provider's average claim amount is 4.2x the specialty mean, with 89% of patients from a single governorate")

---

## 4. Claim Denial Prediction & Prevention

This is where AI can directly impact HCX participants' financial performance.

### Industry Context

- 24% of claims are denied during evaluation (Doctor-Patient Rights Project)
- 15% of private insurer claims are initially denied even after prior auth (AHA)
- Organizations using AI-driven risk assessment report **34% reduction in denied claims** and **41% decrease in days in A/R**
- 82% overturn rate on Medicare Advantage appeals — most denials are preventable

### Open-Source Approaches

**Pre-Submission Claim Scrubbing:**
- Build a rule engine from Egyptian insurer contract terms (payer-specific coverage rules)
- ML model trained on historical denial reasons to flag high-risk claims before submission
- Feature set: diagnosis-procedure alignment, coverage limits, prior authorization requirements, patient eligibility status

**Denial Pattern Mining:**
- Unsupervised clustering on denied claims to discover systematic denial patterns per payer
- Time-series analysis of denial rate trends per provider/payer pair
- Root cause classification model (coding error, eligibility issue, medical necessity, authorization gap)

**Appeal Automation:**
- LLM-based appeal letter generation using denial reason + clinical documentation
- John Snow Labs demonstrated medical LLM-as-a-Judge for prior auth denial review
- Pattern: denial letter → NER extraction of denial reason → match against clinical evidence → generate appeal

### Egypt Implementation

HCX is uniquely positioned because it sits between ALL providers and ALL payers. This means:
- HCX can learn denial patterns across the entire market and pre-warn providers
- Payer-specific rule engines can be built from observed denial patterns rather than manual rule coding
- The Supervisor dashboard (from AWS sample) can show each payer their denial rate vs market average

---

## 5. Clinical NLP & Medical Text Processing

### Core Libraries

| Library | License | Capabilities | Egypt Readiness |
|---------|---------|-------------|-----------------|
| **Spark NLP** (core) | Apache 2.0 | NER, text classification, embeddings, 250+ languages | Arabic support built-in. 15,000+ free models |
| **PyHealth** | MIT | EHR ML pipeline (MIMIC, eICU, OMOP-CDM), 33+ clinical ML models, drug recommendation, mortality/readmission prediction | Supports OMOP-CDM format — if HCX adopts OMOP, PyHealth pipelines work directly |
| **spaCy + medspaCy** | MIT | Clinical NER, section detection, context detection | English-focused; Arabic requires custom models |
| **Hugging Face Transformers** | Apache 2.0 | BioBERT, ClinicalBERT, PubMedBERT, AraBERT, and 1000s of medical models | AraBERT and ABioNER available for Arabic biomedical NER (85% F1) |
| **cTAKES** (Apache) | Apache 2.0 | Clinical text extraction from EHR free-text | Mature but English-only |

### Arabic Medical NLP — Current State

This is an active research area with several important developments:

- **MedAraBench** (2026): Large-scale Arabic medical QA dataset covering 19 specialties and 5 difficulty levels. Best model (GPT-5) achieved 76.5% accuracy — still below expert performance
- **MedArabiQ** (AraHealthQA challenge): 700 clinical samples in MSA, including MCQ, fill-in-blank, and open-ended QA
- **ABioNER**: BERT-based Arabic biomedical NER achieving 85% F1 on disease/treatment extraction
- **AraBERT**: General Arabic BERT that can be fine-tuned for medical tasks
- **BiMediX** (MBZUAI): Bilingual English-Arabic medical LLM, outperforms Jais-30B on all Arabic medical categories
- Arabic medical LLM fine-tuning: Mistral-7B and LLaMA-2-7B with LoRA adaptation for Arabic medical text generation

**Key gap:** No Arabic clinical coding model exists yet. This is an opportunity for HealthFlow to build the first Arabic ICD-10 coding model using NDP/HCX data and contribute it to the open-source community (excellent positioning for the AUC academic track).

---

## 6. Drug Interaction & Formulary Validation

### Available Resources

| Resource | Type | Relevance |
|----------|------|-----------|
| **RxNorm API** (NLM) | Drug terminology standard | Map international drug names to standard codes |
| **DrugBank** (open data subset) | Drug-drug interaction database | 15,000+ drug entries with interaction data |
| **OpenFDA Drug API** | FDA drug adverse events, labeling | Cross-reference for international drug safety |
| **PyHealth SafeDrug** | ML model for safe drug recommendation | Predicts drug combinations minimizing adverse interactions |
| **EDA Drug Database** | Egypt-specific | Your existing 47,292 registered medicines — this IS the Egyptian formulary |

### Egypt Implementation

Your AI Medication Validation Engine (already at 96.3% accuracy) is ahead of most open-source alternatives. The enhancement opportunity:

1. **RAG over EDA formulary:** Embed all 47,292 drug entries with descriptions, contraindications, and interactions. Use for real-time claim validation
2. **SafeDrug model from PyHealth:** Train on Egyptian prescription patterns from NDP data for drug-drug interaction detection at claim time
3. **Formulary compliance agent:** LangGraph agent that checks if prescribed drugs are covered under the specific insurer's formulary (each private insurer has different coverage lists)

---

## 7. Validation & Trust Infrastructure

### Epic AI Validation Suite
Epic released an open-source AI validation tool (GitHub, Apache 2.0) enabling healthcare organizations to test and monitor AI models. Features:
- Automated validation data collection
- Analysis broken down by demographics (age, sex, race/ethnicity)
- Common monitoring templates and data schema
- Extensible to new AI models

This could be adapted for FRA regulatory oversight of AI models deployed on HCX.

### MONAI (Medical Open Network for AI)
- End-to-end open-source toolkit for medical AI development
- While focused on imaging, its evaluation and deployment pipeline patterns are applicable to any medical AI

---

## Recommended Model Stack for HealthFlow HCX

### Phase 1 (Months 0–3): Foundation
| Function | Model | Hosting |
|----------|-------|---------|
| Claim reasoning | MedGemma 27B Text | DigitalOcean GPU or dedicated A100 |
| Arabic clinical NLP | BiMediX + AraBERT | Same GPU instance |
| ICD-10 validation | Fine-tuned Llama 8B on EDA codes | Shared inference |
| Drug validation | Existing AI Medication Engine | Already deployed |

### Phase 2 (Months 3–6): Intelligence Layer
| Function | Model | Hosting |
|----------|-------|---------|
| Fraud detection | XGBoost ensemble + Isolation Forest | CPU (K8s pod) |
| Denial prediction | Gradient Boosted classifier on HCX denial history | CPU (K8s pod) |
| Cross-payer analytics | PyHealth pipeline on OMOP-CDM data | Spark cluster or single-node |

### Phase 3 (Months 6–12): Agentic System
| Function | Model | Hosting |
|----------|-------|---------|
| LangGraph Coordinator | Orchestration only (no LLM) | K8s (lightweight) |
| Fraud Agent | MedGemma + XGBoost ensemble | GPU + CPU |
| Policy Agent | Rule engine + eligibility cache (Redis) | CPU |
| Medical Coding Agent | Fine-tuned ICD-10 model + EDA RAG | GPU |
| Investigation Agent | MedGemma for reasoning over flagged cases | GPU |
| Memory Service | Redis + PostgreSQL for pattern storage | Existing infra |

### Total GPU Requirement
- Phase 1–2: Single A100 80GB (or 2x A10 24GB) — ~$2–3/hr on cloud, or ~$15K for dedicated hardware
- Phase 3: 2x A100 for production inference with redundancy

---

## Data Sovereignty & Compliance Notes

All recommended models can be **fully self-hosted** — no data leaves Egyptian infrastructure:
- MedGemma, GPT-OSS, Qwen: downloadable weights, run on Ollama or vLLM
- BiMediX: HuggingFace download, run locally
- PyHealth, Spark NLP (core): Apache 2.0, no phone-home
- XGBoost/scikit-learn: fully local training and inference

This satisfies CBE, FRA, and NHIA data residency requirements. The only external dependency is initial model weight download (one-time).

---

## Academic Opportunity (AUC)

HealthFlow has a unique opportunity to publish the **first Arabic healthcare claims AI system** — no such model or benchmark exists. Potential papers:

1. "Arabic ICD-10 Coding from Clinical Notes: A Fine-Tuned LLM Approach Using Egyptian Drug Formulary Data"
2. "Cross-Payer Fraud Detection in Emerging Health Insurance Markets: Lessons from Egypt's Universal Health Insurance Rollout"
3. "Agentic AI for Healthcare Claims Adjudication in Low-Resource Language Settings"

These would be first-of-kind contributions to both the Arabic medical NLP and healthcare AI communities.
