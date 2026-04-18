**SOFTWARE REQUIREMENTS SPECIFICATION**

**HealthFlow HCX AI-Powered Claims Exchange**

Intelligent Adjudication Layer for Egypt\'s National Health Insurance
Infrastructure

Version 2.0 --- Enhanced with Off-Shelf Tooling & HFCX Platform
Integration

April 2026 \| IEEE 830-1998 Compliant \| Classification: Confidential

*Prepared by: HealthFlow Group --- Synthesized from 6 OSS projects +
hfcx-platform reference implementation*

Table of Contents
=================

[Table of Contents 2](#table-of-contents)

[1. Introduction 4](#introduction)

[1.1 Purpose 4](#purpose)

[1.2 Relationship to Existing HFCX Platform
4](#relationship-to-existing-hfcx-platform)

[1.3 Source Projects 4](#source-projects)

[2. Off-the-Shelf Open-Source Tools Catalog
6](#off-the-shelf-open-source-tools-catalog)

[2.1 Agent Orchestration & LLM Framework
6](#agent-orchestration-llm-framework)

[2.2 Medical AI Models (Self-Hosted) 6](#medical-ai-models-self-hosted)

[2.3 Healthcare NLP & Clinical Data 7](#healthcare-nlp-clinical-data)

[2.4 Fraud Detection 7](#fraud-detection)

[2.5 Infrastructure & Platform 7](#infrastructure-platform)

[2.6 Frontend & Portal 8](#frontend-portal)

[3. System Architecture --- Integration with Existing HFCX Platform
9](#system-architecture-integration-with-existing-hfcx-platform)

[3.1 Architecture Principle: Additive, Not Replacement
9](#architecture-principle-additive-not-replacement)

[3.2 Integration Touchpoints with hfcx-platform
9](#integration-touchpoints-with-hfcx-platform)

[3.3 Component Diagram --- AI Intelligence Layer
9](#component-diagram-ai-intelligence-layer)

[3.4 Protocol Compliance 10](#protocol-compliance)

[4. Functional Requirements 11](#functional-requirements)

[4.1 AI Agent Orchestration 11](#ai-agent-orchestration)

[4.2 Eligibility Verification Agent 11](#eligibility-verification-agent)

[4.3 Medical Coding Validation Agent
12](#medical-coding-validation-agent)

[4.4 Fraud Detection Agent 12](#fraud-detection-agent)

[4.5 Medical Necessity Agent 13](#medical-necessity-agent)

[4.6 Shared Memory & Pattern Learning
13](#shared-memory-pattern-learning)

[4.7 Portal Enhancements (Next.js) 14](#portal-enhancements-next.js)

[5. Data Model --- Extensions to Existing HFCX Schema
15](#data-model-extensions-to-existing-hfcx-schema)

[5.1 ai\_claim\_analysis (new table) 15](#ai_claim_analysis-new-table)

[5.2 ai\_agent\_memory (new table) 15](#ai_agent_memory-new-table)

[5.3 ai\_audit\_log (new table, append-only)
16](#ai_audit_log-new-table-append-only)

[6. API Specification 17](#api-specification)

[6.1 External APIs (NO CHANGE to existing HFCX)
17](#external-apis-no-change-to-existing-hfcx)

[6.2 Internal AI APIs (NEW) 17](#internal-ai-apis-new)

[7. Non-Functional Requirements 18](#non-functional-requirements)

[8. Security Requirements 18](#security-requirements)

[9. Testing Strategy 20](#testing-strategy)

[10. Deployment 20](#deployment)

[10.1 Deployment Architecture 20](#deployment-architecture)

[10.2 CI/CD 20](#cicd)

[10.3 Monitoring 21](#monitoring)

[11. Appendices 22](#appendices)

[Appendix A: Complete Off-Shelf Tool Stack (Buy Nothing, Build Minimum)
22](#appendix-a-complete-off-shelf-tool-stack-buy-nothing-build-minimum)

[Appendix B: HFCX Integration Guide Section Mapping
23](#appendix-b-hfcx-integration-guide-section-mapping)

[Appendix C: Phased Rollout Plan 23](#appendix-c-phased-rollout-plan)

1. Introduction
===============

1.1 Purpose
-----------

This SRS defines the AI-powered intelligent adjudication layer that
extends the existing HealthFlow HFCX platform (hfcx-platform repository,
1,990 commits, Java/Scala/JavaScript). The document specifies how
open-source AI/ML capabilities shall be integrated into the existing HCX
protocol --- preserving the current JWE encryption, FHIR R4 data model,
asynchronous callback pattern, and participant registry --- while adding
multi-agent AI adjudication, fraud detection, medical coding validation,
and regulatory analytics.

1.2 Relationship to Existing HFCX Platform
------------------------------------------

The existing hfcx-platform provides the claims exchange backbone:

  --------------------- -------------------------------- ------------------------------------------------------------------------------------------------------------------------------------ ------------
  **Existing Module**   **Repository Path**              **Function**                                                                                                                         **Status**
  API Gateway           api-gateway/                     Routes requests to appropriate payer/provider, enforces protocol headers (X-HCX-\*)                                                  Production
  HCX APIs              hcx-apis/                        Core API microservices: /coverageeligibility/check, /preauth/submit, /claim/submit, /communication/request, /paymentnotice/request   Production
  HCX Core              hcx-core/                        Shared library: JWE encryption/decryption, FHIR validation, protocol header parsing                                                  Production
  Pipeline Jobs         hcx-pipeline-jobs/               Async Scala jobs for claim routing, validation, event processing                                                                     Production
  Registry              hcx-registry/schemas/            Participant registry with public keys, roles, credentials                                                                            Production
  Onboarding            hcx-onboard/ + onboarding-app/   Self-service participant onboarding portal                                                                                           Production
  Scheduler Jobs        hcx-scheduler-jobs/              Scheduled batch processing (reporting, reconciliation)                                                                               Production
  Demo App              demo-app/                        Reference mock provider/payer applications                                                                                           Available
  Postman Collection    postman-collection/poc/          API testing collection for all endpoints                                                                                             Available
  --------------------- -------------------------------- ------------------------------------------------------------------------------------------------------------------------------------ ------------

**CRITICAL:** This SRS does NOT replace the existing platform. It
defines a new AI Intelligence Layer that plugs into the existing
hcx-pipeline-jobs async processing pipeline. Claims continue to flow
through the existing API Gateway and HCX APIs; the AI layer intercepts
claims at the pipeline stage to enrich them with AI analysis before
routing to payers.

1.3 Source Projects
-------------------

  -------- ------------------------------------------------------------ ------------------------------------------------------------------------------------------------ -------------
  **ID**   **Project**                                                  **What We Take**                                                                                 **License**
  P1       aws-samples/sample-agentic-insurance-claims-processing-eks   LangGraph multi-agent orchestration, 4-portal model, fraud scoring, shared memory, HPA configs   MIT-0
  P2       aws-samples/serverless-eda-insurance-claims-processing       Event-driven async pattern, voice FNOL agent, EventBridge integration                            MIT-0
  P3       aws-samples/guidance-for-omnichannel-claims-processing       Multimodal GenAI (document/image analysis), Bedrock knowledge bases                              MIT-0
  P4       aws-samples/sample-agentic-platform                          LLM Gateway, Memory Gateway, Retrieval Gateway, JWT inter-service auth, OpenTelemetry            MIT-0
  P5       Open-source AI/ML ecosystem                                  MedGemma, BiMediX, PyHealth, Spark NLP, ICD-10 models, fraud models                              Various OSS
  P6       HealthFlow-Medical-HCX/hfcx-platform                         Existing HCX platform: APIs, protocol, JWE, registry, pipeline jobs                              MIT
  -------- ------------------------------------------------------------ ------------------------------------------------------------------------------------------------ -------------

2. Off-the-Shelf Open-Source Tools Catalog
==========================================

Every capability in this SRS shall leverage existing free/open-source
tools before any custom development. The following catalog maps each
functional area to recommended tools, eliminating build-from-scratch for
80%+ of the AI layer.

2.1 Agent Orchestration & LLM Framework
---------------------------------------

  ------------------ ------------- ----------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------
  **Tool**           **License**   **Purpose**                                                                                           **Why Selected Over Alternatives**
  LangGraph 0.6.7+   MIT           Multi-agent state machine orchestration with conditional routing, parallel execution, checkpointing   P1 proven pattern; superior to CrewAI (less mature) and AutoGen (Microsoft-centric). Runs on Python, integrates with LangChain ecosystem.
  LangChain 0.3.x    MIT           LLM abstraction layer, tool integration, prompt management                                            Industry standard; 85K+ GitHub stars. Provides model-agnostic interface.
  LiteLLM            MIT           Unified LLM API proxy --- routes to Ollama, vLLM, or any provider via OpenAI-compatible interface     P4\'s LLM Gateway pattern. Hot-swap models without agent code changes. Tracks cost/latency per model.
  Ollama             MIT           Self-hosted LLM inference runtime                                                                     Simplest path to run MedGemma, Qwen, Llama locally. No external API dependencies. Used in P1.
  vLLM               Apache 2.0    High-throughput LLM serving with PagedAttention                                                       50-100% faster than Ollama for production batch inference. Use for high-volume claim processing.
  ------------------ ------------- ----------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------

2.2 Medical AI Models (Self-Hosted)
-----------------------------------

  ------------------------------ ----------------------- ---------- ----------------------------------------------------------------------------------------------------- -------------
  **Model**                      **License**             **Size**   **Purpose**                                                                                           **VRAM**
  MedGemma 27B Text              Open (Google HAI-DEF)   27B        Primary claim reasoning engine. 87.7% MedQA. Retains non-English (Arabic) capability.                 24GB (A100)
  MedGemma 4B Multimodal         Open (Google HAI-DEF)   4B         Document/image analysis for attached medical records, prescriptions, lab reports.                     8GB
  BiMediX (MBZUAI)               CC-BY-NC-SA 4.0         8x7B MoE   Bilingual Arabic-English medical QA. 10+ pts above Jais-30B on Arabic medical benchmarks.             24GB
  Qwen 3 7B                      Apache 2.0              7B         Lightweight edge model for pharmacy/clinic-level validation. Arabic tokenization.                     8GB
  Fine-tuned Llama 8B (ICD-10)   Llama License           8B         ICD-10 code validation. Research shows 97% exact match after fine-tuning on code-description pairs.   8GB
  ------------------------------ ----------------------- ---------- ----------------------------------------------------------------------------------------------------- -------------

2.3 Healthcare NLP & Clinical Data
----------------------------------

  ------------------------- ------------- ----------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------
  **Tool**                  **License**   **Purpose**                                                                                                       **Integration Point**
  Spark NLP (core)          Apache 2.0    NER, text classification, embeddings in 250+ languages including Arabic. 15,000+ free models.                     Medical Coding Agent --- extract clinical entities from claim descriptions for ICD-10 validation
  PyHealth 2.0              MIT           Healthcare ML pipeline: 33+ models, OMOP-CDM support, ICD/CPT/NDC/ATC built-in. Drug recommendation (SafeDrug).   Fraud Detection Agent --- train anomaly models on HCX claims data; Drug interaction checking
  HAPI FHIR Server          Apache 2.0    Java-based FHIR R4 server with validation, search, and terminology services.                                      Extends hcx-core FHIR validation; provides terminology server for ICD-10/SNOMED lookups
  AraBERT + ABioNER         Apache 2.0    Arabic BERT + Arabic biomedical NER (85% F1 on disease/treatment extraction).                                     Arabic clinical note processing in Medical Coding Agent and Necessity Agent
  MedAraBench / MedArabiQ   Research      Arabic medical QA benchmark (19 specialties, 5 difficulty levels). Best model: 76.5% accuracy.                    Evaluation benchmark for Arabic medical model accuracy testing
  ------------------------- ------------- ----------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------

2.4 Fraud Detection
-------------------

  ----------------- ------------- ------------------------------------------------------------------------------------------------------------ --------------------------------------------------------------------------
  **Tool**          **License**   **Purpose**                                                                                                  **Integration Point**
  scikit-learn      BSD-3         Isolation Forest, Random Forest, XGBoost wrapper for anomaly detection and classification.                   Fraud Agent --- unsupervised anomaly detection on claim features
  XGBoost           Apache 2.0    Gradient boosted trees for supervised fraud classification. Industry standard for tabular fraud detection.   Fraud Agent --- supervised model after labeled fraud data available
  NetworkX          BSD-3         Graph analysis library for provider-patient-pharmacy network fraud detection.                                SIU Portal --- visualize fraud rings; detect unusual provider clustering
  PyOD              BSD-2         30+ outlier detection algorithms. Supports ensemble of detectors.                                            Fraud Agent --- ensemble of multiple anomaly detectors for robustness
  Faker + Mimesis   MIT           Synthetic data generation for test claims.                                                                   Replaces P1\'s Demo Generator; generates Egyptian-specific test data
  ----------------- ------------- ------------------------------------------------------------------------------------------------------------ --------------------------------------------------------------------------

2.5 Infrastructure & Platform
-----------------------------

  ------------------------- --------------------- -------------------------------------------------------------------------------- -------------------------------------------------------------------------------
  **Tool**                  **License**           **Purpose**                                                                      **Replaces Building**
  Keycloak                  Apache 2.0            Identity provider, OIDC/OAuth 2.0, RBAC. Already in HCX stack.                   Custom auth system. Supports Arabic locale.
  Redis 7+                  BSD-3                 Agent state checkpointing (P1 pattern), eligibility cache, session management.   Custom state store. Already in HealthFlow stack.
  PostgreSQL 15+            PostgreSQL License    FHIR data store, audit log, analytics. Already in HealthFlow stack.              MongoDB (P1\'s choice). Better for FHIR\'s defined schemas + FRA audit.
  Apache Kafka / Redpanda   Apache 2.0            Event bus for async claim processing pipeline. Replaces P1\'s sync HTTP.         Custom message broker. Integrates with existing hcx-pipeline-jobs Scala jobs.
  Grafana + Prometheus      AGPL-3 / Apache 2.0   Monitoring dashboards, alerting, metrics collection.                             Custom monitoring. P1 uses CloudWatch (AWS-locked).
  OpenTelemetry             Apache 2.0            Distributed tracing across agent pipeline. P4 pattern.                           Custom tracing. Vendor-neutral.
  MinIO                     AGPL-3                S3-compatible object storage for medical document attachments.                   AWS S3 dependency. Self-hosted for data sovereignty.
  Jaeger                    Apache 2.0            Distributed trace visualization. Complements OpenTelemetry.                      AWS X-Ray dependency.
  ------------------------- --------------------- -------------------------------------------------------------------------------- -------------------------------------------------------------------------------

2.6 Frontend & Portal
---------------------

  ------------- ------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------
  **Tool**      **License**   **Purpose**                                                                                       **Replaces Building**
  Next.js 14+   MIT           React framework for all portal UIs. SSR for Arabic RTL. Already in HealthFlow stack.              P1\'s FastAPI HTML templates. Much richer UX capability.
  Shadcn/ui     MIT           Component library with accessible, customizable components.                                       Custom component library.
  Recharts      MIT           React charting for KPI dashboards, fraud trends, claim analytics.                                 Custom D3 charts.
  React Flow    MIT           Interactive node-based graph visualization for provider-patient network analysis in SIU portal.   Custom graph rendering.
  next-intl     MIT           Internationalization with Arabic RTL support.                                                     Custom i18n. Handles bidirectional text correctly.
  ------------- ------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------

3. System Architecture --- Integration with Existing HFCX Platform
==================================================================

3.1 Architecture Principle: Additive, Not Replacement
-----------------------------------------------------

The AI Intelligence Layer is injected into the existing claim processing
pipeline between the API Gateway and the Payer callback. The existing
hcx-pipeline-jobs (Scala) shall emit a ClaimReceived event to Kafka. The
AI layer consumes this event, runs multi-agent analysis, and publishes
an EnrichedClaim event that the pipeline jobs consume to route to payers
with AI annotations.

3.2 Integration Touchpoints with hfcx-platform
----------------------------------------------

  ------------------------------------ ------------------------------------------------------------------------------------------------ --------------------------------------------------------------------------------------------------------------------
  **Existing Component**               **Integration Method**                                                                           **AI Layer Interaction**
  API Gateway (api-gateway/)           No change. Continues routing /claim/submit, /coverageeligibility/check, etc.                     AI layer is invisible to external API consumers. Existing JWE encryption, protocol headers (X-HCX-\*) preserved.
  HCX APIs (hcx-apis/)                 Minimal change: add Kafka event emission after claim validation passes.                          Existing FHIR validation in hcx-core remains. AI layer receives already-validated FHIR Claim bundles.
  Pipeline Jobs (hcx-pipeline-jobs/)   Add Kafka consumer/producer. Existing Scala jobs publish ClaimReceived; consume EnrichedClaim.   AI enrichment is async --- does not block claim acknowledgment (HTTP 202 still returned immediately per protocol).
  Registry (hcx-registry/)             Read-only access for participant lookup.                                                         AI layer queries registry to resolve provider/payer metadata for fraud analysis and eligibility caching.
  Demo App (demo-app/)                 Extend with AI analysis display panels.                                                          Add AI recommendation cards to mock provider and mock payer reference apps.
  Postman Collection                   Add AI-specific test requests.                                                                   New collection folder for /internal/agents/\* endpoints.
  ------------------------------------ ------------------------------------------------------------------------------------------------ --------------------------------------------------------------------------------------------------------------------

3.3 Component Diagram --- AI Intelligence Layer
-----------------------------------------------

**LAYER A --- EXISTING HFCX (Java/Scala, unchanged)**

-   API Gateway → HCX APIs → FHIR Validation (hcx-core) → Pipeline Jobs
    → Kafka Topic: hcx.claims.validated

**LAYER B --- NEW AI INTELLIGENCE (Python, additive)**

-   Kafka Consumer reads from hcx.claims.validated

-   LangGraph Coordinator Agent receives FHIR Claim bundle

-   Parallel agent execution via LiteLLM Gateway → self-hosted models
    (Ollama/vLLM)

-   Agents: Eligibility (Redis cache + Registry lookup), Medical Coding
    (Spark NLP + fine-tuned Llama), Fraud (XGBoost + PyOD + NetworkX),
    Medical Necessity (MedGemma RAG over EDA formulary)

-   Shared Memory Service (Redis + PostgreSQL) stores learned patterns

-   Results published to Kafka Topic: hcx.claims.enriched

**LAYER C --- ENRICHED ROUTING (Scala, extends existing)**

-   Existing pipeline jobs consume hcx.claims.enriched

-   AI analysis JSON attached to FHIR ClaimResponse as extension

-   Claim routed to payer via existing /claim/on\_submit callback with
    AI enrichment

-   Payer dashboard shows AI recommendations alongside claim data

3.4 Protocol Compliance
-----------------------

All existing HFCX protocol specifications are preserved:

  ------------------------ ----------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Protocol Element**     **Spec Reference (Integration Guide)**                                              **AI Layer Compliance**
  JWE Encryption           Section 25-28: RSA-OAEP-256 + A256GCM                                               AI layer operates on decrypted FHIR bundles inside the pipeline. No encryption change. AI analysis results re-encrypted before callback.
  Protocol Headers         Section 24.5: X-HCX-Sender-Code, X-HCX-Recipient-Code, X-HCX-Correlation-ID, etc.   All headers pass through unchanged. AI adds X-HCX-AI-Score and X-HCX-AI-Recommendation as optional extension headers.
  Async Callback Pattern   Section 24.1: POST → 202 Accepted → callback on\_\* endpoint                        AI processing occurs between 202 acknowledgment and callback. No change to external-facing async model.
  FHIR R4 Resources        Section 29: Patient, Claim, ClaimResponse, Coverage, etc.                           AI results stored as FHIR ClaimResponse.extension\[\] per FHIR R4 extension mechanism.
  Bearer Token Auth        Section 14.3: client\_credentials grant                                             AI internal APIs use separate service-to-service JWT. External APIs use existing bearer token flow.
  Error Codes              Section 24.6: ERR-P-\*, ERR-B-\*, ERR-T-\*                                          New error codes: ERR-AI-001 (model unavailable), ERR-AI-002 (confidence below threshold). Graceful degradation: claim continues without AI if models fail.
  ------------------------ ----------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------

4. Functional Requirements
==========================

*Each requirement now includes the specific off-the-shelf tool that
implements it.*

4.1 AI Agent Orchestration
--------------------------

  ----------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- ---------------------------------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                                              **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-AO-001   The system shall implement a LangGraph Coordinator Agent that consumes FHIR Claim bundles from Kafka topic hcx.claims.validated and orchestrates parallel execution of specialized agents.   Must           High        P1,P6         Tool: LangGraph 0.6.7 + kafka-python. Coordinator processes claims within 3s; routes to min 2 agents per claim.
  FR-AO-002   The LLM Gateway shall abstract model access behind LiteLLM, supporting hot-swap between MedGemma 27B, Qwen 3, and fine-tuned Llama without agent code changes.                               Must           Med         P4            Tool: LiteLLM (MIT). Model swap in \<60s. A/B testing via LiteLLM\'s built-in routing. Tracks token cost per model.
  FR-AO-003   AI agent results shall be published to Kafka topic hcx.claims.enriched as a FHIR ClaimResponse extension, consumed by existing hcx-pipeline-jobs for routing.                                Must           Med         P6,ENHANCED   Tool: kafka-python + HAPI FHIR. Existing Scala pipeline jobs read enriched claims with zero code change to external APIs.
  FR-AO-004   The system shall support graceful degradation: if AI agents are unavailable, claims shall bypass AI enrichment and route directly to payers with a warning flag.                             Must           Med         ENHANCED      Tool: Kafka dead-letter topic + circuit breaker (resilience4j pattern). Claims never blocked by AI failure.
  ----------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- ---------------------------------------------------------------------------------------------------------------------------

4.2 Eligibility Verification Agent
----------------------------------

  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                                 **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-EV-001   The Eligibility Agent shall verify patient coverage by querying the NHIA/private insurer via existing /coverageeligibility/check API and cache results in Redis with 24h TTL.   Must           Med         P1,P6         Tool: Redis 7 (existing stack). Cache key: hcx:elig:{national\_id}:{payer\_id}. Cache hit \<5ms, miss \<3s.
  FR-EV-002   The agent shall validate patient National ID (14-digit Egyptian format) against the hcx-registry participant database.                                                          Must           Low         P6,ENHANCED   Tool: hcx-registry/schemas/ existing validation. No new tool needed.
  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------------------

4.3 Medical Coding Validation Agent
-----------------------------------

  ----------- ---------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                      **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-MC-001   The Medical Coding Agent shall validate ICD-10 diagnosis codes against procedure codes using a fine-tuned Llama 8B model served via Ollama.          Must           High        P5,ENHANCED   Tool: Ollama + fine-tuned Llama 8B. Research: 97% exact match on code-description pairs (npj Health Systems 2025).
  FR-MC-002   The agent shall detect upcoding patterns by comparing claim diagnosis severity against provider specialty baseline using Spark NLP NER extraction.   Should         High        P5,ENHANCED   Tool: Spark NLP (Apache 2.0) clinical NER pipeline. Extract entities → compare against specialty averages from HCX historical data.
  FR-MC-003   The agent shall cross-reference pharmacy claims against NDP prescription data to detect medications not prescribed or already dispensed.             Must           High        ENHANCED      Tool: REST call to existing NDP API (internal). No new tool --- uses HealthFlow\'s existing NDP platform.
  FR-MC-004   The agent shall validate drug codes against EDA formulary using RAG (Retrieval-Augmented Generation) over the 47,292 registered medicines.           Must           High        P5,ENHANCED   Tool: ChromaDB (Apache 2.0) vector store + MedGemma 27B for reasoning. EDA formulary embedded as vector index.
  ----------- ---------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------------------------------------------

4.4 Fraud Detection Agent
-------------------------

  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------- ----------- ------------- ----------------------------------------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                          **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-FD-001   The Fraud Agent shall compute risk scores (0.0-1.0) using an ensemble of Isolation Forest (unsupervised) and XGBoost (supervised) models trained on HCX claims data.     Must           High        P1,P5         Tool: scikit-learn Isolation Forest + XGBoost (Apache 2.0). Train on HCX data; retrain monthly.
  FR-FD-002   The agent shall perform cross-payer duplicate detection by hashing (patient\_nid + service\_date + procedure\_code) and checking across all claims in a 30-day window.   Must           Med         ENHANCED      Tool: PostgreSQL with partial index on hash. No ML needed --- deterministic check. Unique to HCX\'s exchange-wide view.
  FR-FD-003   The agent shall analyze provider-patient-pharmacy networks for organized fraud patterns using graph algorithms.                                                          Should         High        P5,ENHANCED   Tool: NetworkX (BSD-3) for graph construction; community detection algorithms. Visualize in SIU portal via React Flow.
  FR-FD-004   The agent shall use PyOD ensemble for robust outlier detection across 15+ claim features (amount, frequency, diagnosis mix, provider patterns).                          Should         High        P5            Tool: PyOD (BSD-2). 30+ outlier detection algorithms. Ensemble of top-3 detectors for robustness.
  FR-FD-005   The agent shall generate human-readable fraud explanations using MedGemma, citing specific risk factors.                                                                 Should         Med         P1,P5         Tool: MedGemma 27B via LiteLLM. Prompt: \'Explain why this claim scored {score} for fraud risk given these factors: {factors}\'.
  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------- ----------- ------------- ----------------------------------------------------------------------------------------------------------------------------------

4.5 Medical Necessity Agent
---------------------------

  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                                 **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-MN-001   The Medical Necessity Agent shall assess clinical appropriateness by cross-referencing diagnosis codes against treatment codes and EDA formulary clinical guidelines via RAG.   Should         High        ENHANCED      Tool: ChromaDB + MedGemma 27B. RAG over EDA clinical guidelines + WHO essential medicines list.
  FR-MN-002   For pre-authorization requests (/preauth/submit), the agent shall provide automated clinical guideline citations supporting approve/deny recommendations.                       Should         High        P6,ENHANCED   Tool: MedGemma 27B + LangChain RetrievalQA chain. Source: EDA guidelines embedded in ChromaDB.
  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- -------------------------------------------------------------------------------------------------

4.6 Shared Memory & Pattern Learning
------------------------------------

  ----------- -------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------ -----------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                **Priority**   **Cmplx**   **Source**   **Acceptance Criteria / Off-Shelf Tool**
  FR-SM-001   The Shared Memory Service shall store agent-learned patterns in Redis (hot cache) and PostgreSQL (persistent store), enabling cross-agent knowledge sharing.   Must           Med         P1           Tool: Redis 7 (existing) + PostgreSQL (existing). P1\'s pattern with persistence added.
  FR-SM-002   Fraud patterns detected by any agent shall be accessible to all agents within 1 second of storage.                                                             Must           Low         P1           Tool: Redis pub/sub for real-time pattern propagation across agents.
  ----------- -------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------ -----------------------------------------------------------------------------------------

4.7 Portal Enhancements (Next.js)
---------------------------------

  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- ---------------------------------------------------------------------------------------------------------------------------------
  **ID**      **Description**                                                                                                                                                     **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  FR-PE-001   The Provider Portal shall display AI-powered denial appeal guidance with specific documentation suggestions when a claim is denied.                                 Should         Med         P5,ENHANCED   Tool: Next.js 14 + shadcn/ui + MedGemma for appeal text generation. Arabic RTL via next-intl.
  FR-PE-002   The Payer Dashboard shall present AI recommendations alongside claim details in a split-panel view with confidence scores and expandable agent analysis sections.   Must           Med         P1            Tool: Next.js 14 + shadcn/ui + Recharts for score visualization. Mirrors P1\'s Adjuster Dashboard.
  FR-PE-003   The SIU Portal shall visualize provider-patient-pharmacy networks as interactive graphs with fraud cluster highlighting.                                            Could          High        P5,ENHANCED   Tool: React Flow (MIT) for graph visualization. Data from NetworkX analysis.
  FR-PE-004   The Regulatory Dashboard shall display market-wide KPIs (loss ratio, fraud rate, denial rate by governorate) with drill-down capability.                            Must           Med         P1,ENHANCED   Tool: Recharts + Next.js. Governorate heat map via react-simple-maps. Arabic PDF reports via existing docx generation pipeline.
  FR-PE-005   All portals shall support Arabic RTL as default with English toggle, using next-intl for internationalization.                                                      Must           Med         ENHANCED      Tool: next-intl (MIT). All date formats: DD/MM/YYYY. Currency: EGP. Bidirectional text handled natively.
  ----------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- ---------------------------------------------------------------------------------------------------------------------------------

5. Data Model --- Extensions to Existing HFCX Schema
====================================================

The existing hfcx-platform database schema is preserved. The AI layer
adds three new tables:

### 5.1 ai\_claim\_analysis (new table)

  ---------------------- ------------------- ------------------------------------------------- -------------------------------------------------------------------
  **Field**              **Type**            **Constraints**                                   **Notes**
  analysis\_id           UUID PK             Auto-generated                                    
  claim\_id              VARCHAR             FK to existing claims table via correlation\_id   Links to existing HCX claim via X-HCX-Correlation-ID
  risk\_score            DECIMAL(3,2)        0.00-1.00                                         Fraud Detection Agent output
  recommendation         ENUM                approve, deny, investigate, NULL                  Coordinator synthesis
  confidence             DECIMAL(3,2)        0.00-1.00                                         Overall AI confidence
  eligibility\_result    JSONB                                                                 Eligibility Agent output
  coding\_result         JSONB                                                                 Medical Coding Agent output
  fraud\_result          JSONB                                                                 Fraud Detection Agent output with feature importances
  necessity\_result      JSONB                                                                 Medical Necessity Agent output (nullable for non-clinical claims)
  model\_versions        JSONB                                                                 Model names + versions used for reproducibility
  processing\_time\_ms   INTEGER                                                               Total AI processing time
  created\_at            TIMESTAMP WITH TZ   NOT NULL, indexed                                 
  ---------------------- ------------------- ------------------------------------------------- -------------------------------------------------------------------

### 5.2 ai\_agent\_memory (new table)

  ------------------- ------------------- ------------------------------------------------------------------ -----------------------------------
  **Field**           **Type**            **Constraints**                                                    **Notes**
  memory\_id          UUID PK             Auto-generated                                                     
  agent\_type         ENUM                coordinator, eligibility, coding, fraud, necessity                 
  pattern\_type       ENUM                fraud\_signal, coding\_error, denial\_pattern, provider\_anomaly   
  pattern\_data       JSONB                                                                                  Structured pattern representation
  confidence          DECIMAL(3,2)                                                                           Pattern confidence
  occurrence\_count   INTEGER             Default 1                                                          Incremented on re-observation
  last\_claim\_id     VARCHAR                                                                                Most recent triggering claim
  created\_at         TIMESTAMP WITH TZ   NOT NULL                                                           
  updated\_at         TIMESTAMP WITH TZ   NOT NULL                                                           
  ------------------- ------------------- ------------------------------------------------------------------ -----------------------------------

### 5.3 ai\_audit\_log (new table, append-only)

  ------------------------ ------------------- ------------------------------- ---------------------------------------------------------
  **Field**                **Type**            **Constraints**                 **Notes**
  log\_id                  BIGSERIAL PK        Immutable, auto-increment       FRA compliance: no UPDATE or DELETE permissions
  event\_type              VARCHAR(100)                                        ai.scored, ai.recommended, human.decided, model.updated
  claim\_correlation\_id   VARCHAR                                             Links to X-HCX-Correlation-ID
  agent\_name              VARCHAR                                             Which agent took action
  action\_detail           JSONB                                               Full detail of AI reasoning
  created\_at              TIMESTAMP WITH TZ   NOT NULL, partitioned monthly   
  ------------------------ ------------------- ------------------------------- ---------------------------------------------------------

6. API Specification
====================

6.1 External APIs (NO CHANGE to existing HFCX)
----------------------------------------------

All existing HFCX API endpoints remain unchanged per the Integration
Guide. External consumers (providers, payers) interact with the same
endpoints:

  -------------------------------- ----------------------------------- ---------------------------------------------------------------------------
  **Endpoint**                     **Per Integration Guide Section**   **Change**
  /coverageeligibility/check       Section 16                          NONE --- AI eligibility caching is invisible to callers
  /coverageeligibility/on\_check   Section 16                          NONE
  /preauth/submit                  Section 17                          NONE --- AI necessity assessment added as extension in ClaimResponse
  /preauth/on\_submit              Section 17                          NONE
  /claim/submit                    Section 18                          NONE --- AI analysis attached as FHIR extension in callback ClaimResponse
  /claim/on\_submit                Section 18                          MINOR --- ClaimResponse includes ai\_analysis extension block
  /communication/request           Section 19                          NONE
  /paymentnotice/request           Section 20                          NONE
  /status/request                  Section 24                          NONE
  -------------------------------- ----------------------------------- ---------------------------------------------------------------------------

6.2 Internal AI APIs (NEW)
--------------------------

These endpoints are internal-only, not exposed through the API Gateway.
Inter-service auth via service JWT.

  ------------ ---------------------------------------- ----------------------------------------------- --------------------------------------------
  **Method**   **Endpoint**                             **Description**                                 **Tool**
  POST         /internal/ai/coordinate                  Submit FHIR Claim bundle for AI orchestration   LangGraph Coordinator
  POST         /internal/ai/agents/eligibility/verify   Eligibility check with Redis caching            Custom + Redis
  POST         /internal/ai/agents/coding/validate      ICD-10 validation                               Spark NLP + Ollama (Llama 8B)
  POST         /internal/ai/agents/fraud/score          Fraud risk scoring                              XGBoost + PyOD + NetworkX
  POST         /internal/ai/agents/necessity/assess     Medical necessity assessment                    MedGemma + ChromaDB RAG
  POST         /internal/ai/memory/store                Store agent pattern                             Redis + PostgreSQL
  GET          /internal/ai/memory/context/{agent}      Retrieve agent context                          Redis
  POST         /internal/ai/llm/completion              Model-agnostic LLM completion                   LiteLLM proxy
  GET          /internal/ai/health                      AI layer health check                           Custom (returns model status, queue depth)
  GET          /internal/ai/metrics                     Prometheus metrics endpoint                     prometheus-client (Python)
  ------------ ---------------------------------------- ----------------------------------------------- --------------------------------------------

7. Non-Functional Requirements
==============================

  --------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- --------------------------------------------------------------------------------------------
  **ID**    **Description**                                                                                                                                                   **Priority**   **Cmplx**   **Source**    **Acceptance Criteria / Off-Shelf Tool**
  NFR-001   The AI layer shall process claims within 5 seconds E2E (Kafka consume → AI analysis → Kafka publish). This is within the existing HFCX claim processing window.   Must           High        P1,P6         Tool: vLLM for throughput. Benchmark: 50+ claims/min/GPU on A100.
  NFR-002   The AI layer shall scale horizontally: Coordinator 3-10 pods, Fraud Agent 3-15 pods via Kubernetes HPA at 70% CPU.                                                Must           Med         P1            Tool: K8s HPA (built-in). Same config pattern as P1.
  NFR-003   All AI models shall be self-hosted within Egyptian-approved data centers. Zero PHI egress to external services.                                                   Must           Low         P5,ENHANCED   Tool: Ollama/vLLM on DigitalOcean GPU droplets or dedicated hardware in Egypt.
  NFR-004   The system shall maintain 99.5% AI layer availability; graceful degradation when AI is unavailable (claims bypass to manual queue).                               Must           Med         ENHANCED      Tool: Kafka DLQ + K8s health probes + circuit breaker pattern.
  NFR-005   AI model updates shall be zero-downtime via LiteLLM blue-green model routing.                                                                                     Must           Med         P4            Tool: LiteLLM model aliasing. Route 100% traffic to model-v1, gradually shift to model-v2.
  NFR-006   Distributed tracing across the full claim pipeline (Java HCX APIs → Kafka → Python AI agents → Kafka → Scala pipeline jobs).                                      Must           Med         P4            Tool: OpenTelemetry (Apache 2.0) with Jaeger UI. Cross-language tracing.
  --------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------- --------------------------------------------------------------------------------------------

8. Security Requirements
========================

  --------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------ ---------------------------------------------------------------------------------------------------------
  **ID**    **Description**                                                                                                                                                             **Priority**   **Cmplx**   **Source**   **Acceptance Criteria / Off-Shelf Tool**
  SEC-001   AI internal APIs shall use service-to-service JWT tokens, separate from external bearer tokens (Integration Guide Section 14.3).                                            Must           Med         P4,P6        Tool: Keycloak service accounts (existing). No new auth system.
  SEC-002   JWE encryption (RSA-OAEP-256 + A256GCM per Integration Guide Section 25.3) shall be maintained. AI layer operates on decrypted data within the trusted pipeline boundary.   Must           Low         P6           Tool: Existing hcx-core JWE library (Java). AI layer receives pre-decrypted FHIR bundles from pipeline.
  SEC-003   The ai\_audit\_log table shall be append-only (no UPDATE/DELETE) with monthly partitioning for FRA compliance.                                                              Must           Low         ENHANCED     Tool: PostgreSQL table permissions + pg\_partman extension.
  SEC-004   All AI model weights shall be stored in encrypted storage. Private encryption keys per Integration Guide Section 14.2 best practices.                                       Must           Med         P6           Tool: MinIO with server-side encryption (SSE-S3) for model artifact storage.
  SEC-005   PHI in AI agent logs shall be redacted. Only claim correlation IDs, not patient data, appear in logs.                                                                       Must           Med         ENHANCED     Tool: structlog (MIT) with custom PHI redaction filter. Log claim\_id and X-HCX-Correlation-ID only.
  --------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------- ----------- ------------ ---------------------------------------------------------------------------------------------------------

9. Testing Strategy
===================

Testing leverages existing HFCX testing infrastructure (Integration
Guide Part VII) extended for AI:

  ---------------- ---------------------------------------------------------------------------------------------------- ----------------------------------------------- ------------
  **Test Level**   **Scope**                                                                                            **Tool**                                        **Source**
  Unit             Individual agent logic, FHIR extension creation, fraud feature engineering                           pytest + pytest-cov (target 80%)                P1
  Integration      Agent-to-Kafka, Redis cache, PostgreSQL persistence                                                  testcontainers-python + Docker Compose          P4
  E2E              Full claim lifecycle: /claim/submit → AI enrichment → /claim/on\_submit callback with AI extension   Existing Postman Collection (P6) + k6 scripts   P6,P1
  AI Model         Fraud F1\>0.85, ICD-10 accuracy\>90%, Arabic medical QA via MedAraBench                              PyHealth evaluation + MedAraBench benchmark     P5
  Sandbox          Test with reference mock apps (demo-app/) per Integration Guide Section 32                           Existing HFCX sandbox environment               P6
  Load             100K claims/day sustained, p95\<8s E2E                                                               k6 (MIT) + Grafana k6 Cloud                     P1
  Security         Zero PHI leakage, RBAC verification, JWE integrity after AI enrichment                               OWASP ZAP + custom RBAC matrix tests            ENHANCED
  ---------------- ---------------------------------------------------------------------------------------------------- ----------------------------------------------- ------------

10. Deployment
==============

10.1 Deployment Architecture
----------------------------

-   AI layer deploys as a separate Kubernetes namespace (hcx-ai)
    alongside existing hcx namespace

-   GPU node pool: 1-4 nodes with NVIDIA A100 or A10 for LLM inference
    (Ollama/vLLM pods)

-   CPU node pool: auto-scaling for Coordinator, Fraud Agent, Coding
    Agent, Eligibility Agent

-   Shared infrastructure: PostgreSQL, Redis, Kafka (shared with
    existing hcx-pipeline-jobs)

10.2 CI/CD
----------

-   Existing HFCX CI (.github/workflows/) continues unchanged for
    Java/Scala services

-   New AI layer CI: GitHub Actions for Python: lint (ruff), test
    (pytest), build Docker image, push to registry

-   CD: ArgoCD for GitOps deployment of AI layer. Model updates via
    LiteLLM hot-swap (no pod restart).

10.3 Monitoring
---------------

  ------------------------ -------------------------- -------------------------------------------------------------------------------------------
  **Concern**              **Tool**                   **Dashboards**
  Claim pipeline metrics   Prometheus + Grafana       Claims/min, AI processing latency, agent success rates, Kafka lag
  AI model performance     Custom Grafana dashboard   Fraud F1 score (rolling 7-day), ICD-10 accuracy, model inference latency, GPU utilization
  Distributed tracing      OpenTelemetry + Jaeger     Full claim trace: Java API → Kafka → Python AI → Kafka → Scala pipeline → Payer callback
  Alerting                 Grafana Alerting           PagerDuty for: AI layer down \>5min, Kafka consumer lag \>1000, model accuracy drift \>5%
  Logging                  Loki (Grafana)             Structured JSON logs with X-HCX-Correlation-ID for cross-service claim tracing
  ------------------------ -------------------------- -------------------------------------------------------------------------------------------

11. Appendices
==============

Appendix A: Complete Off-Shelf Tool Stack (Buy Nothing, Build Minimum)
----------------------------------------------------------------------

  --------------------- --------------------------------------------------------- -------------------------- ----------------------- ----------------------------------------------------
  **Category**          **Tool**                                                  **License**                **Cost**                **Replaces Custom Dev Effort**
  Agent Orchestration   LangGraph + LangChain                                     MIT                        Free                    \~3 months of custom state machine development
  LLM Gateway           LiteLLM                                                   MIT                        Free                    \~1 month custom model proxy
  LLM Serving           Ollama + vLLM                                             MIT / Apache 2.0           Free (+ GPU hardware)   Cloud LLM API costs (\$10K+/month)
  Medical Reasoning     MedGemma 27B                                              Open                       Free                    No equivalent commercial model at this price point
  Arabic Medical NLP    BiMediX + AraBERT                                         CC-BY-NC-SA / Apache 2.0   Free                    \~6 months custom Arabic medical model training
  ICD-10 Validation     Fine-tuned Llama 8B + Spark NLP                           Llama / Apache 2.0         Free                    \~2 months custom coding validation
  Fraud Detection       scikit-learn + XGBoost + PyOD + NetworkX                  BSD / Apache 2.0           Free                    \~3 months custom fraud ML pipeline
  Healthcare ML         PyHealth 2.0                                              MIT                        Free                    \~2 months custom healthcare ML pipeline
  Vector Store (RAG)    ChromaDB                                                  Apache 2.0                 Free                    \~1 month custom embedding search
  Event Bus             Kafka / Redpanda                                          Apache 2.0                 Free                    Integrates with existing hcx-pipeline-jobs (Scala)
  Identity              Keycloak                                                  Apache 2.0                 Free                    Already in HealthFlow stack
  Frontend              Next.js + shadcn/ui + Recharts + React Flow + next-intl   MIT                        Free                    Already in HealthFlow stack (Next.js)
  Monitoring            Prometheus + Grafana + Loki + Jaeger + OpenTelemetry      Various OSS                Free                    \~1 month custom monitoring setup
  Object Storage        MinIO                                                     AGPL-3                     Free                    Self-hosted S3-compatible for data sovereignty
  FHIR Server           HAPI FHIR                                                 Apache 2.0                 Free                    Extends existing hcx-core FHIR validation
  Test Data Gen         Faker + Mimesis                                           MIT                        Free                    Replaces P1\'s custom Demo Generator
  --------------------- --------------------------------------------------------- -------------------------- ----------------------- ----------------------------------------------------

**TOTAL ESTIMATED SAVINGS:** By using off-the-shelf tools instead of
custom development, the AI Intelligence Layer development is reduced
from \~18 months (full custom) to \~4-6 months (integration + Egyptian
adaptation). The primary custom work required: (1) fine-tuning Llama 8B
on EDA\'s 47,292 drug codes for ICD-10 validation, (2) training fraud
models on initial HCX claims data, (3) building the Kafka bridge between
existing Java/Scala pipeline and new Python AI agents.

Appendix B: HFCX Integration Guide Section Mapping
--------------------------------------------------

This table maps each Integration Guide section to the corresponding SRS
requirement:

  ---------------------------------- ------------------------------------------- ----------------------------- --------------------------------------------------------------------
  **Integration Guide Section**      **Topic**                                   **SRS Requirement**           **AI Impact**
  Section 16: Coverage Eligibility   Eligibility verification workflow           FR-EV-001, FR-EV-002          AI caches results in Redis; invisible to callers
  Section 17: Pre-Authorization      Pre-auth submit/response workflow           FR-MN-001, FR-MN-002          AI adds medical necessity assessment to pre-auth response
  Section 18: Claims Submission      Claim submit/adjudicate workflow            FR-AO-001 through FR-FD-005   Full AI enrichment pipeline between submit and adjudicate
  Section 19: Communication          Information exchange between participants   No change                     Future: AI-generated information request responses
  Section 20: Payment Notification   Payment processing workflow                 No change                     Future: AI-optimized payment prioritization
  Section 24: API Architecture       Protocol headers, error codes               SEC-001, 6.1, 6.2             New X-HCX-AI-\* extension headers; new ERR-AI-\* codes
  Section 25-28: Data Security       JWE encryption, key management              SEC-002, SEC-004              AI operates within trusted pipeline boundary; encryption preserved
  Section 29: FHIR Guidelines        FHIR R4 resources and profiles              5.1 (ai\_claim\_analysis)     AI results as FHIR ClaimResponse.extension\[\]
  Section 30-33: Testing             Testing strategy, sandbox, reference apps   Section 9 (Testing)           AI tests extend existing sandbox and Postman collections
  ---------------------------------- ------------------------------------------- ----------------------------- --------------------------------------------------------------------

Appendix C: Phased Rollout Plan
-------------------------------

  --------------------------------- -------------- ---------------------------------------------------------- -----------------------------------------------------------------------------------------------
  **Phase**                         **Duration**   **Scope**                                                  **Key Deliverables**
  Phase 0: Infrastructure           Weeks 1-2      Deploy Kafka, LiteLLM, Ollama, monitoring stack            Kafka bridge between hcx-pipeline-jobs and AI layer; LiteLLM serving MedGemma 27B
  Phase 1: Eligibility + Coding     Weeks 3-8      Eligibility caching + ICD-10 validation                    FR-EV-\*, FR-MC-\*. Every claim gets automated eligibility + coding check. Human-in-the-loop.
  Phase 2: Fraud Detection          Weeks 9-16     Cross-payer fraud scoring + SIU portal                     FR-FD-\*. Unsupervised first (Isolation Forest); supervised after 3 months of labeled data.
  Phase 3: Medical Necessity        Weeks 17-24    Pre-auth AI assessment + EDA RAG                           FR-MN-\*. ChromaDB loaded with EDA formulary. Targets pre-auth workflow.
  Phase 4: Analytics & Regulatory   Weeks 25-32    Supervisor dashboard + FRA reporting                       FR-PE-004. Market-wide KPIs, governorate drill-down, Arabic compliance reports.
  Phase 5: Continuous Learning      Ongoing        Pattern learning, model retraining, accuracy improvement   FR-SM-\*. Monthly model retraining on accumulating HCX claims data.
  --------------------------------- -------------- ---------------------------------------------------------- -----------------------------------------------------------------------------------------------

*--- End of Document ---*
