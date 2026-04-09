# HFCX AI Claims — Intelligent Adjudication Platform

**AI-Powered Claims Processing + Multi-Portal Frontend for Egypt's National Health Insurance Infrastructure**

> A production-ready platform comprising an **AI adjudication backend** (Python/FastAPI) and a
> **multi-portal frontend** (Next.js 14) — designed as an additive intelligence layer that integrates
> with the existing HealthFlow HCX platform (hfcx-platform, 1,990 commits, Java/Scala/JavaScript)
> with zero changes to the existing API Gateway, HCX APIs, or FHIR validation pipeline.

| Metric | Value |
|--------|-------|
| **Total tracked files** | 166 |
| **Total lines of code** | 32,000+ |
| **Backend (Python)** | 39 source files, 38 test files |
| **Frontend (TypeScript)** | 66 files across 4 portals |
| **Backend test coverage** | 109 tests, 80%+ coverage |
| **Frontend test coverage** | 30 Vitest tests + Playwright e2e |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Backend — AI Adjudication Layer](#backend--ai-adjudication-layer)
3. [Frontend — Portal Applications](#frontend--portal-applications)
4. [Project Structure](#project-structure)
5. [Quick Start](#quick-start)
6. [API Reference](#api-reference)
7. [Kafka Integration](#kafka-integration)
8. [Development](#development)
9. [Testing](#testing)
10. [Deployment](#deployment)
11. [Observability](#observability)
12. [Security](#security)
13. [Phased Rollout](#phased-rollout)
14. [License](#license)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LAYER A — EXISTING HFCX PLATFORM (Java/Scala, UNCHANGED)                      │
│                                                                                  │
│  Provider/Payer → API Gateway → HCX APIs → FHIR Validation (hcx-core)         │
│                                           ↓                                     │
│                                 hcx-pipeline-jobs (Scala)                       │
│                                           ↓                                     │
│                           Kafka: hcx.claims.validated  ──────────────────┐     │
└──────────────────────────────────────────────────────────────────────────│──────┘
                                                                           │
┌──────────────────────────────────────────────────────────────────────────│──────┐
│  LAYER B — AI INTELLIGENCE (Python/FastAPI, THIS PROJECT — src/)         │      │
│                                                                           ↓      │
│  Kafka Consumer ── LangGraph Coordinator ──► Parallel Agents:                   │
│                                              ├─ Eligibility  (Redis + Registry) │
│                                              ├─ Medical Coding (LLM + NER)      │
│                                              ├─ Fraud Detection (ML Ensemble)   │
│                                              ├─ Medical Necessity (RAG)         │
│                                              └─ Multimodal (MedGemma 4B)       │
│                                                       ↓                         │
│                           Kafka: hcx.claims.enriched ─────────────────┐        │
│                                                                        │        │
│  REST API (/internal/ai/*) ◄──── BFF Routes (/internal/ai/bff/*) ◄───┼────┐   │
└───────────────────────────────────────────────────────────────────────│────│───┘
                                                                        │    │
┌───────────────────────────────────────────────────────────────────────│────│───┐
│  LAYER C — FRONTEND PORTALS (Next.js 14, THIS PROJECT — frontend/)    │    │    │
│                                                                        ↓    ↑    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐       │
│  │  Provider     │  │  Payer       │  │  SIU       │  │  Regulatory │       │
│  │  Portal       │  │  Portal      │  │  Portal    │  │  Portal     │       │
│  │  (§4)         │  │  (§5)        │  │  (§6)      │  │  (§7)       │       │
│  └──────────────┘  └──────────────┘  └────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                                                        │
┌───────────────────────────────────────────────────────────────────────│────────┐
│  LAYER A (continued) — hcx-pipeline-jobs → Payer callback with FHIR   ↓       │
│  ClaimResponse.extension[] carrying AI adjudication results                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Key Design Principle:** The AI layer is **additive, not replacement**. Claims continue to
receive HTTP 202 acknowledgments immediately; AI enrichment is async within the existing
pipeline processing window (< 5 seconds, NFR-001). The frontend portals consume AI results
through dedicated BFF (Backend-for-Frontend) routes.

---

## Backend — AI Adjudication Layer

### Core Agents (`src/agents/`)

| Agent | Tool Stack | SRS Ref | Description |
|-------|-----------|---------|-------------|
| **Coordinator** | LangGraph 0.6.7 state machine, Redis checkpointing | FR-AO-001 | Orchestrates eligibility-first, then coding/fraud/necessity in parallel, then adjudication |
| **Eligibility** | Redis L1 cache (24hr TTL, SHA-256 key) + HFCX registry fallback | FR-EV-001 | Patient eligibility verification with circuit breaker |
| **Medical Coding** | Llama 8B (ICD-10) + AraBERT (Arabic NER via BiMediX) + HAPI FHIR terminology | FR-MC-001 | ICD-10 format check, Arabic clinical entity extraction, semantic validation |
| **Fraud Detection** | Isolation Forest + XGBoost + PyOD ensemble + NetworkX rolling provider scores | FR-FD-001 | 15+ engineered features, rule engine, anomaly detection, network graph analysis |
| **Medical Necessity** | MedGemma 27B + ChromaDB RAG (EDA formulary 47,292 codes + NHIA guidelines) | FR-MN-001 | Evidence-based necessity assessment with Arabic clinical summaries |
| **Multimodal** | MedGemma 4B vision via LiteLLM | SRS §2.2 | Document/image analysis from MinIO attachments |

### Services (`src/services/`)

| Service | Purpose |
|---------|---------|
| **LLM Service** | LiteLLM gateway client with retry, timeout, and model routing |
| **Redis Service** | Async Redis client with connection pooling — cache, state, pub/sub |
| **Audit Service** | Append-only audit logging with bounded queue + background flusher (SEC-003) |
| **Circuit Breaker** | Native asyncio circuit breaker (closed/open/half-open state machine) |
| **Drift Service** | 7-day rolling window model drift monitoring with per-model Prometheus gauges |
| **HAPI FHIR Service** | `CodeSystem/$validate-code` with 24hr Redis cache + circuit breaker |
| **Model Store** | XGBoost model loading from MinIO (Booster + sklearn artifact shapes) |
| **NDP Service** | National Drug Platform API integration for drug code validation |

### BFF Routes (`src/api/routes/bff.py`)

Portal-specific aggregation endpoints that power the frontend dashboards:

| Route | SRS | Description |
|-------|-----|-------------|
| `GET /bff/provider/summary` | §4.2.1 | Provider dashboard KPIs — claims by status, approval rate, avg processing time |
| `GET /bff/payer/summary` | §5.1 | Payer dashboard — queue depth, auto-approval rate, pending reviews |
| `GET /bff/siu/summary` | §6.1 | SIU dashboard — flagged claims, risk distribution, top providers |
| `GET /bff/regulatory/summary` | §7.2.1 | Regulatory overview — market-wide metrics, 12-month trends |
| `GET /bff/claims` | §4.2.3, §5.2.1, §6.2.1 | Portal-aware claim list with filters, pagination, sorting |
| `GET /bff/siu/network` | §6.2.2 | Fraud network graph — provider/patient nodes + risk edges |

### Database Schema (`migrations/`)

| Table | Purpose |
|-------|---------|
| `ai_claim_analysis` | Primary analysis results — one row per claim with full agent outputs |
| `ai_agent_memory` | Shared pattern learning across agents (L2 durable store) |
| `ai_audit_log` | Append-only audit trail, monthly partitioned via pg_partman (FRA compliance) |

---

## Frontend — Portal Applications

Built with **Next.js 14 App Router** implementing the full `SRS-HealthFlow-HCX-Frontend-Portals-v1.0`.

### Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Next.js 14** | App Router, server components, standalone build |
| **TypeScript** | Full type safety, strict mode |
| **shadcn/ui + Radix** | Accessible component primitives |
| **TailwindCSS** | Utility-first styling with CSS logical properties (RTL-native) |
| **next-intl** | Arabic (default) + English internationalization |
| **TanStack Query** | Server state management with caching |
| **TanStack Table** | Headless data tables with sorting, filtering, pagination |
| **Recharts** | Dashboard charts and trend visualizations |
| **React Flow** | Interactive fraud network graph visualization |
| **Zustand** | Lightweight client state management |
| **React Hook Form + Zod** | Form handling with schema validation |
| **Lucide React** | Icon system |

### Portal Applications

| Portal | Route | Key Screens | SRS |
|--------|-------|-------------|-----|
| **Portal Selector** | `/` | Landing page with role-based portal selection | §3.1 |
| **Provider Portal** | `/provider/*` | Dashboard (KPIs) · New Claim form (Zod + field arrays) · Claims History (DataTable) | §4.2 |
| **Payer Portal** | `/payer/*` | Dashboard · Claims Queue Kanban with detail panel + decision panel | §5.2 |
| **SIU Portal** | `/siu/*` | Dashboard · Flagged Claims (tabbed table) · Network Analysis (React Flow graph) | §6.2 |
| **Regulatory Portal** | `/regulatory/*` | Market Overview with Recharts 12-month trend line | §7.2 |

### Design System (SRS §2)

| Component | SRS Ref | Description |
|-----------|---------|-------------|
| `ClaimStatusBadge` | §2.3 | Color + icon + label for all 8 claim statuses |
| `AIRecommendationCard` | DS-AI-001 | AI decision display with confidence and reasoning |
| `ConfidenceBar` | DS-AI-002 | Color-coded confidence visualization (green/amber/red) |
| `FraudGauge` | DS-AI-003 | Fraud risk score gauge with contributing factors |
| `PatientNidInput` | FR-EV-002 | Egyptian National ID input (Western + Arabic-Indic digits) |
| `KpiCard` | §4.2.1 | Reusable dashboard metric card |
| `DataTable` | §4.2.3 | TanStack-powered sortable, filterable data table |
| `NetworkGraph` | §6.2.2 | React Flow fraud network visualization |
| `LanguageToggle` | §8 | Arabic/English switch with cookie persistence |

### Internationalization

Full Arabic (default) and English support via `next-intl`:
- `messages/ar.json` — Arabic translations covering all portals, status badges, AI reasoning, claim fields
- `messages/en.json` — English translations
- Arabic-Indic digit rendering for numeric values
- CSS logical properties for seamless RTL layout
- `hcx_locale` cookie for language persistence

---

## Project Structure

```
hfcx-ai-claims/
├── src/                              # Backend — Python/FastAPI
│   ├── agents/                       # AI agents
│   │   ├── coordinator.py            # LangGraph state machine (FR-AO-001)
│   │   ├── eligibility.py            # Redis cache + registry (FR-EV-001)
│   │   ├── medical_coding.py         # ICD-10 + Arabic NER (FR-MC-001)
│   │   ├── fraud_detection.py        # ML ensemble + NetworkX (FR-FD-001)
│   │   ├── medical_necessity.py      # ChromaDB RAG + MedGemma (FR-MN-001)
│   │   └── multimodal.py             # MedGemma 4B vision (SRS §2.2)
│   ├── api/
│   │   ├── middleware.py             # Keycloak JWT auth (SEC-001)
│   │   └── routes/
│   │       ├── coordinator.py        # POST /internal/ai/coordinate
│   │       ├── agents.py             # Individual agent endpoints
│   │       ├── bff.py                # BFF routes for frontend portals
│   │       ├── feedback.py           # POST /internal/ai/feedback (drift)
│   │       ├── health.py             # Health + readiness probes
│   │       ├── llm.py                # LLM completion proxy
│   │       └── memory.py             # Agent memory CRUD
│   ├── kafka/
│   │   └── consumer.py              # hcx.claims.validated → AI → enriched
│   ├── models/
│   │   ├── orm.py                    # SQLAlchemy async ORM
│   │   └── schemas.py               # Pydantic request/response models
│   ├── services/
│   │   ├── audit_service.py          # Append-only audit (SEC-003)
│   │   ├── circuit_breaker.py        # Asyncio circuit breaker
│   │   ├── drift_service.py          # Model drift monitoring
│   │   ├── hapi_fhir_service.py      # HAPI FHIR terminology validation
│   │   ├── llm_service.py            # LiteLLM gateway client
│   │   ├── model_store.py            # XGBoost model loading (MinIO)
│   │   ├── ndp_service.py            # National Drug Platform API
│   │   └── redis_service.py          # Async Redis + agent memory
│   ├── utils/
│   │   ├── fhir_parser.py            # FHIR R4 Bundle/Claim extraction
│   │   ├── phi_redactor.py           # PHI redaction for logs (SEC-005)
│   │   ├── logging.py                # Structured logging (structlog)
│   │   └── metrics.py                # Prometheus metrics definitions
│   ├── config.py                     # Pydantic settings (env-driven)
│   └── main.py                       # FastAPI app factory + lifespan
│
├── frontend/                         # Frontend — Next.js 14 / TypeScript
│   ├── app/                          # App Router pages
│   │   ├── page.tsx                  # Portal selector landing (§3.1)
│   │   ├── layout.tsx                # Root layout + providers
│   │   ├── globals.css               # Design system HSL tokens (§2.2)
│   │   ├── provider/                 # Provider portal pages
│   │   │   ├── page.tsx              # Dashboard (§4.2.1)
│   │   │   ├── claims/new/page.tsx   # New claim form (§4.2.2)
│   │   │   └── claims/page.tsx       # Claims history (§4.2.3)
│   │   ├── payer/                    # Payer portal pages
│   │   │   ├── page.tsx              # Dashboard (§5.1)
│   │   │   └── claims/page.tsx       # Claims queue Kanban (§5.2.1)
│   │   ├── siu/                      # SIU portal pages
│   │   │   ├── page.tsx              # Dashboard (§6.1)
│   │   │   ├── flagged/page.tsx      # Flagged claims (§6.2.1)
│   │   │   └── network/page.tsx      # Network analysis (§6.2.2)
│   │   └── regulatory/              # Regulatory portal pages
│   │       └── page.tsx              # Market overview (§7.2.1)
│   ├── components/
│   │   ├── shared/                   # Reusable AI/domain components
│   │   │   ├── ai-recommendation-card.tsx
│   │   │   ├── claim-status-badge.tsx
│   │   │   ├── confidence-bar.tsx
│   │   │   ├── fraud-gauge.tsx
│   │   │   ├── patient-nid-input.tsx
│   │   │   ├── kpi-card.tsx
│   │   │   ├── data-table.tsx
│   │   │   ├── network-graph.tsx
│   │   │   ├── claim-card.tsx
│   │   │   └── language-toggle.tsx
│   │   ├── ui/                       # shadcn/ui primitives
│   │   └── layout/                   # Portal shell + navigation
│   ├── lib/
│   │   ├── api.ts                    # API client (auto X-HCX-Correlation-ID)
│   │   ├── types.ts                  # TypeScript DTOs (mirrors Pydantic)
│   │   └── utils.ts                  # Currency, date, digit helpers
│   ├── messages/
│   │   ├── ar.json                   # Arabic translations (default)
│   │   └── en.json                   # English translations
│   ├── tests/                        # Vitest unit tests (30 tests)
│   ├── e2e/                          # Playwright e2e tests
│   ├── Dockerfile                    # Multi-stage standalone build
│   └── package.json                  # Dependencies + scripts
│
├── tests/                            # Backend tests (109 tests)
│   ├── test_agents/                  # Agent unit tests
│   ├── test_api/                     # API route tests (incl. BFF)
│   ├── test_services/                # Service unit tests
│   ├── test_kafka/                   # Kafka consumer tests
│   ├── integration/                  # Integration tests (testcontainers)
│   ├── load/                         # k6 load test scripts
│   └── postman/                      # Postman collection
│
├── migrations/
│   ├── init.sql                      # DDL for 3 SRS tables
│   ├── alembic/                      # Alembic migration framework
│   │   └── versions/
│   │       ├── 20260409_0001_baseline.py
│   │       └── 20260409_0002_pg_partman_setup.py
│   └── README.md
│
├── config/
│   ├── litellm_config.yaml           # Model routing (blue-green aliases)
│   └── prometheus.yml                # Prometheus scrape config
│
├── k8s/
│   ├── manifests.yaml                # Backend: namespace, deployments, HPA, NetworkPolicy
│   └── frontend.yaml                 # Frontend: deployment, HPA, service, ingress
│
├── docs/
│   ├── SRS-HealthFlow-HCX-AI-v2.0-Enhanced.docx
│   ├── SRS-HealthFlow-HCX-Frontend-Portals-v1.0.docx
│   └── research.md                   # AI/ML model landscape analysis
│
├── docker-compose.yml                # Full stack: 12 services
├── Dockerfile                        # Backend container image
├── pyproject.toml                    # Python project config + dependencies
├── alembic.ini                       # Alembic configuration
├── .env.example                      # Environment variable template
└── .github/workflows/ci.yml          # CI: backend + frontend + integration
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 22+ and npm
- Docker + Docker Compose
- 16 GB RAM (32 GB recommended for full model stack)

### 1. Clone and configure

```bash
git clone https://github.com/HealthFlowEgy/hfcx-ai-claims.git
cd hfcx-ai-claims
cp .env.example .env
# Edit .env — set SECRET_KEY, KEYCLOAK_CLIENT_SECRET, DATABASE_URL
```

### 2. Start full stack (backend + frontend + infrastructure)

```bash
docker compose up -d
```

This starts **12 services**: Postgres 15, Redis 7, Redpanda (Kafka), ChromaDB, MinIO, Ollama, LiteLLM, AI Claims API, AI Kafka Consumer, Frontend, Jaeger, Prometheus, and Grafana.

### 3. Pull AI models (first-time, ~30 min)

```bash
docker exec hfcx-ai-ollama ollama pull qwen3:7b          # Fast model (8 GB)
docker exec hfcx-ai-ollama ollama pull llama3:8b-instruct # Coding model (8 GB)
docker exec hfcx-ai-ollama ollama pull nomic-embed-text    # Embeddings (274 MB)
# Production: also pull medgemma:27b and bimediX:8x7b (requires GPU node)
```

### 4. Seed ChromaDB with EDA formulary

```bash
pip install -e ".[dev]"
python scripts/seed_chromadb.py --demo    # Demo data
# Production: python scripts/seed_chromadb.py --eda-csv /path/to/eda_formulary.csv
```

### 5. Run database migrations

```bash
# Initial schema
docker exec hfcx-ai-postgres psql -U hfcx_ai -d hfcx_ai -f /docker-entrypoint-initdb.d/init.sql

# Alembic migrations (partitioning, etc.)
alembic upgrade head
```

### 6. Verify

```bash
# Backend health
curl http://localhost:8090/internal/ai/health

# Frontend
open http://localhost:3000
```

### Development mode (without Docker)

```bash
# Backend
pip install -e ".[dev]"
uvicorn src.main:app --reload --port 8090
python -m src.kafka.consumer &

# Frontend
cd frontend
npm install
npm run dev    # http://localhost:3000
```

---

## API Reference

All endpoints require service JWT (Keycloak). In `APP_ENV=development`, auth is bypassed.

### Core AI Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/internal/ai/coordinate` | Full AI adjudication of a FHIR R4 Claim bundle |
| `POST` | `/internal/ai/agents/eligibility/verify` | Eligibility check with Redis caching |
| `POST` | `/internal/ai/agents/coding/validate` | ICD-10 validation with Arabic NER |
| `POST` | `/internal/ai/agents/fraud/score` | Fraud scoring via ML ensemble |
| `POST` | `/internal/ai/agents/necessity/assess` | Medical necessity RAG assessment |
| `POST` | `/internal/ai/feedback` | Model drift feedback ingestion |
| `GET` | `/internal/ai/health` | Health status of all dependencies |
| `GET` | `/internal/ai/metrics` | Prometheus metrics endpoint |
| `GET/POST` | `/internal/ai/memory/*` | Agent memory CRUD |

### BFF Endpoints (Frontend Portals)

| Method | Path | Portal | Description |
|--------|------|--------|-------------|
| `GET` | `/internal/ai/bff/provider/summary` | Provider | Dashboard KPIs |
| `GET` | `/internal/ai/bff/payer/summary` | Payer | Queue depth, auto-approval rate |
| `GET` | `/internal/ai/bff/siu/summary` | SIU | Flagged claims, risk distribution |
| `GET` | `/internal/ai/bff/regulatory/summary` | Regulatory | Market-wide metrics, trends |
| `GET` | `/internal/ai/bff/claims` | All | Portal-aware claim list with filters |
| `GET` | `/internal/ai/bff/siu/network` | SIU | Fraud network graph data |

### Example — Full Adjudication

```bash
curl -X POST http://localhost:8090/internal/ai/coordinate \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fhir_claim_bundle": { "resourceType": "Bundle", ... },
    "hcx_headers": {
      "X-HCX-Correlation-ID": "abc-123",
      "X-HCX-Sender-Code": "PROVIDER-001"
    }
  }'
```

**Response:**
```json
{
  "correlation_id": "abc-123",
  "claim_id": "CLAIM-2026-001",
  "adjudication_decision": "approved",
  "overall_confidence": 0.92,
  "requires_human_review": false,
  "human_review_reasons": [],
  "eligibility": { "is_eligible": true, "cache_hit": true },
  "coding": { "all_codes_valid": true, "confidence_score": 0.97 },
  "fraud": { "fraud_score": 0.08, "risk_level": "low" },
  "necessity": { "is_medically_necessary": true, "arabic_summary": "..." },
  "processing_time_ms": 2340
}
```

---

## Kafka Integration

The AI layer integrates with existing `hcx-pipeline-jobs` (Scala) via Kafka:

| Topic | Direction | Schema |
|-------|-----------|--------|
| `hcx.claims.validated` | Consume | `KafkaClaimMessage` — FHIR R4 Bundle + HCX headers |
| `hcx.claims.enriched` | Produce | `KafkaEnrichedClaimMessage` — original + AI results as FHIR extensions |
| `hcx.claims.ai.dlq` | Produce (errors) | Raw message + error metadata |

**Minimal change to hcx-pipeline-jobs:**
```scala
// In hcx-pipeline-jobs/src/.../ClaimProcessor.scala — after FHIR validation passes:
kafkaProducer.send("hcx.claims.validated", claimBundle.toJson)
// Then consume from hcx.claims.enriched to get AI results attached as FHIR extensions
```

---

## Development

```bash
# Install backend dev dependencies
pip install -e ".[dev]"

# Install frontend dependencies
cd frontend && npm install && cd ..

# Backend lint + type check
ruff check src/ tests/
mypy src/

# Frontend lint + type check
cd frontend
npm run lint
npx tsc --noEmit
```

---

## Testing

### Test Matrix

| Layer | Tool | Count | Coverage | Command |
|-------|------|-------|----------|---------|
| Backend unit | pytest | 109 tests | 80%+ | `pytest tests/ -v --cov=src` |
| Backend integration | pytest + testcontainers | 2 suites | — | `pytest tests/integration/ -v` |
| Backend load | k6 | 3 scripts | — | `k6 run tests/load/coordinate_sustained.js` |
| Backend API | Postman | 1 collection | — | Import `tests/postman/*.json` |
| Frontend unit | Vitest | 30 tests | — | `cd frontend && npm test` |
| Frontend e2e | Playwright | 1 suite | — | `cd frontend && npx playwright test` |
| Lint (backend) | ruff | — | — | `ruff check src/ tests/` |
| Types (backend) | mypy | 39 files | — | `mypy src/` |
| Lint (frontend) | ESLint | — | — | `cd frontend && npm run lint` |
| Types (frontend) | TypeScript | — | — | `cd frontend && npx tsc --noEmit` |

### Generate test claims

```bash
python scripts/generate_test_claims.py --normal 100 --fraud 10
```

---

## Deployment

### Docker Compose (Development)

```bash
docker compose up -d                    # Start all 12 services
docker compose up -d ai-claims frontend # Start only app services
docker compose logs -f ai-claims        # Follow AI layer logs
docker compose down -v                  # Stop + remove volumes
```

### Kubernetes (Production)

```bash
# Backend: namespace, deployments, HPA, NetworkPolicy
kubectl apply -f k8s/manifests.yaml

# Frontend: deployment, HPA (3-10 replicas), service, ingress
kubectl apply -f k8s/frontend.yaml
```

| Resource | Replicas | HPA Target | Scaling Range |
|----------|----------|------------|---------------|
| `hfcx-ai-api` | 3 | 70% CPU | 3–10 pods |
| `hfcx-ai-consumer` | 3 | 70% CPU | 3–15 pods |
| `hfcx-frontend` | 3 | 70% CPU | 3–10 pods |

### GPU Node Requirements (NFR-003 — Egypt data sovereignty)

| Model | GPU | VRAM |
|-------|-----|------|
| MedGemma 27B | NVIDIA A100 | 24 GB |
| BiMediX 8x7B | NVIDIA A100 | 24 GB |
| Llama 8B + Qwen3 7B | Any GPU | 8 GB (or CPU for dev) |
| MedGemma 4B (multimodal) | Any GPU | 8 GB |

### Model Updates (NFR-005 — Zero-downtime)

Edit `config/litellm_config.yaml` to adjust model routing weights:
```yaml
# Blue-green: shift 20% traffic to new model
- model_name: coordinator-model
  litellm_params:
    model: ollama/medgemma:27b        # v1
    weight: 80
- model_name: coordinator-model
  litellm_params:
    model: ollama/medgemma:27b-v2     # v2
    weight: 20
```
LiteLLM hot-reloads config — no pod restarts required.

---

## Observability

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:3000 | Portal applications |
| **Backend API** | http://localhost:8090 | AI adjudication REST API |
| **Grafana** | http://localhost:3001 | Claims dashboard, fraud trends |
| **Jaeger** | http://localhost:16686 | Distributed traces (OpenTelemetry) |
| **Prometheus** | http://localhost:9090 | Raw metrics |
| **AI Metrics** | http://localhost:8090/internal/ai/metrics | Prometheus scrape endpoint |
| **MinIO Console** | http://localhost:9001 | Model weights + document storage |

### Key Prometheus Metrics

| Metric | Description |
|--------|-------------|
| `hfcx_ai_claims_processed_total` | Total claims throughput |
| `hfcx_ai_adjudication_decisions_total{decision}` | Decisions by type (approved/denied/pended) |
| `hfcx_ai_agent_latency_seconds{agent}` | Per-agent processing latency |
| `hfcx_ai_fraud_high_risk_total` | High-risk fraud alerts |
| `hfcx_ai_kafka_consumer_lag` | Kafka processing backlog |
| `hfcx_ai_model_drift_score{model}` | Per-model drift monitoring gauge |
| `hfcx_ai_circuit_breaker_state{service}` | Circuit breaker state changes |

---

## Security

| Control | SRS Ref | Description |
|---------|---------|-------------|
| **Service JWT** | SEC-001 | Keycloak service-to-service JWT on all internal endpoints |
| **JWE Encryption** | SEC-002 | AI operates on pre-decrypted FHIR bundles within trusted pipeline |
| **Append-only Audit** | SEC-003 | `ai_audit_log` with PostgreSQL rules, monthly partitioned (pg_partman) for FRA |
| **Encrypted Storage** | SEC-004 | Model weights stored encrypted in MinIO (SSE-S3) |
| **PHI Redaction** | SEC-005 | PHI redacted from all logs — only claim correlation IDs logged |
| **Network Policy** | k8s | Namespace-level network isolation in Kubernetes |

---

## Phased Rollout (SRS Appendix C)

| Phase | Weeks | Scope |
|-------|-------|-------|
| **Phase 0** | 1–2 | Infrastructure: Kafka bridge, LiteLLM, Ollama, monitoring |
| **Phase 1** | 3–8 | Eligibility caching + ICD-10 validation (human-in-the-loop) |
| **Phase 2** | 9–16 | Fraud detection + SIU portal (unsupervised → supervised) |
| **Phase 3** | 17–24 | Medical necessity + EDA RAG (pre-auth workflow) |
| **Phase 4** | 25–32 | All four frontend portals + BFF integration + FRA regulatory reporting |
| **Phase 5** | Ongoing | Pattern learning, monthly model retraining, drift monitoring |

---

## License

MIT &copy; HealthFlow Group 2026

---

*Built on: LangGraph (MIT), LiteLLM (MIT), MedGemma (Open HAI-DEF), ChromaDB (Apache 2.0),
Next.js (MIT), shadcn/ui (MIT), TanStack (MIT), React Flow (MIT), Recharts (MIT),
scikit-learn (BSD-3), XGBoost (Apache 2.0), PyOD (BSD-2), NetworkX (BSD-3),
FastAPI (MIT), aiokafka (Apache 2.0)*
