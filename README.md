# HFCX AI Claims Processing Layer

**AI-Powered Intelligent Adjudication for Egypt's National Health Insurance Infrastructure**

> Additive AI intelligence layer that integrates with the existing HealthFlow HCX platform
> (hfcx-platform, 1,990 commits, Java/Scala/JavaScript) — zero changes to the existing API Gateway,
> HCX APIs, or FHIR validation pipeline.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER A — EXISTING HFCX PLATFORM (Java/Scala, UNCHANGED)                  │
│                                                                              │
│  Provider/Payer → API Gateway → HCX APIs → FHIR Validation (hcx-core)     │
│                                         ↓                                   │
│                               hcx-pipeline-jobs (Scala)                     │
│                                         ↓                                   │
│                         Kafka: hcx.claims.validated  ──────────────────┐   │
└─────────────────────────────────────────────────────────────────────────│───┘
                                                                          │
┌─────────────────────────────────────────────────────────────────────────│───┐
│  LAYER B — AI INTELLIGENCE (Python, THIS PROJECT)                       │   │
│                                                                          ↓   │
│  Kafka Consumer ── LangGraph Coordinator ──► Parallel Agents:              │
│                                              ├─ Eligibility (Redis cache)  │
│                                              ├─ Medical Coding (LLM+NLP)   │
│                                              ├─ Fraud Detection (ML)        │
│                                              └─ Medical Necessity (RAG)     │
│                                                      ↓                      │
│                         Kafka: hcx.claims.enriched ──────────────────┐     │
└─────────────────────────────────────────────────────────────────────────────┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────│────┐
│  LAYER A (continued) — hcx-pipeline-jobs → Payer callback with FHIR   ↓   │
│  ClaimResponse.extension[] carrying AI adjudication results                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Design Principle:** The AI layer is **additive, not replacement**. Claims continue to
receive HTTP 202 acknowledgments immediately; AI enrichment is async within the existing
pipeline processing window (< 5 seconds, NFR-001).

---

## Features

| Agent | Tool Stack | SRS Ref |
|-------|-----------|---------|
| **Coordinator** | LangGraph 0.6.7 state machine, Redis checkpointing | FR-AO-001 |
| **Eligibility** | Redis cache (1hr TTL) + HFCX registry | FR-EV-001 |
| **Medical Coding** | Fine-tuned Llama 8B (ICD-10), Spark NLP, AraBERT Arabic NER | FR-MC-001 |
| **Fraud Detection** | Isolation Forest + XGBoost + PyOD ensemble + NetworkX graph | FR-FD-001 |
| **Medical Necessity** | MedGemma 27B + ChromaDB RAG (EDA formulary 47,292 codes) | FR-MN-001 |

---

## Quick Start

### Prerequisites
- Python 3.11+
- Docker + Docker Compose
- 16GB RAM (32GB recommended for full model stack)

### 1. Clone and configure

```bash
git clone https://github.com/HealthFlow-Medical-HCX/hfcx-ai-claims
cd hfcx-ai-claims
cp .env.example .env
# Edit .env — set SECRET_KEY, KEYCLOAK_CLIENT_SECRET, DATABASE_URL
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis redpanda chromadb minio ollama litellm
```

### 3. Pull AI models (first-time, ~30min)

```bash
docker exec hfcx-ai-ollama ollama pull qwen3:7b          # Fast model (8GB)
docker exec hfcx-ai-ollama ollama pull llama3:8b-instruct # Coding model (8GB)
docker exec hfcx-ai-ollama ollama pull nomic-embed-text    # Embeddings (274MB)
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
docker exec hfcx-ai-postgres psql -U hfcx_ai -d hfcx_ai -f /docker-entrypoint-initdb.d/init.sql
```

### 6. Start AI layer

```bash
# API server
docker compose up -d ai-claims

# Kafka consumer (separate process)
docker compose up -d ai-consumer

# Or for development:
uvicorn src.main:app --reload --port 8090
python -m src.kafka.consumer &
```

### 7. Verify

```bash
curl http://localhost:8090/internal/ai/health
```

---

## API Reference

All endpoints require service JWT (Keycloak). In `APP_ENV=development`, auth is bypassed.

### POST /internal/ai/coordinate
Submit a FHIR R4 Claim bundle for full AI adjudication.

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
  "eligibility": { "is_eligible": true, "cache_hit": true, ... },
  "coding": { "all_codes_valid": true, "confidence_score": 0.97, ... },
  "fraud": { "fraud_score": 0.08, "risk_level": "low", ... },
  "necessity": { "is_medically_necessary": true, "arabic_summary": "...", ... },
  "processing_time_ms": 2340
}
```

### POST /internal/ai/agents/fraud/score
Direct fraud scoring without full orchestration.

### POST /internal/ai/agents/coding/validate
ICD-10 validation with Arabic NER.

### POST /internal/ai/agents/eligibility/verify
Eligibility check with Redis caching.

### POST /internal/ai/agents/necessity/assess
Medical necessity RAG assessment.

### GET /internal/ai/health
Health status of all dependencies.

### GET /internal/ai/metrics
Prometheus metrics endpoint.

---

## Kafka Integration

The AI layer integrates with existing `hcx-pipeline-jobs` (Scala) via two Kafka topics:

| Topic | Direction | Schema |
|-------|-----------|--------|
| `hcx.claims.validated` | Consume | `KafkaClaimMessage` |
| `hcx.claims.enriched` | Produce | `KafkaEnrichedClaimMessage` |
| `hcx.claims.ai.dlq` | Produce (errors) | Raw message + error |

**Minimal change to hcx-pipeline-jobs:** Add Kafka event emission after FHIR validation:
```scala
// In hcx-pipeline-jobs/src/.../ClaimProcessor.scala
kafkaProducer.send("hcx.claims.validated", claimBundle.toJson)
```

---

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v --cov=src

# Generate test claims
python scripts/generate_test_claims.py --normal 100 --fraud 10

# Lint
ruff check src/ tests/

# Type check
mypy src/
```

---

## Deployment

### Kubernetes (Production)

```bash
kubectl apply -f k8s/manifests.yaml
# Creates hcx-ai namespace with deployments, HPA, NetworkPolicy

# Scale fraud agent pods (HPA auto-scales 3-15 based on CPU)
kubectl scale deployment hfcx-ai-consumer -n hcx-ai --replicas=6
```

### GPU Node Requirements (NFR-003 — Egypt data sovereignty)
- MedGemma 27B: NVIDIA A100 (24GB VRAM)
- BiMediX 8x7B: NVIDIA A100 (24GB VRAM)
- Llama 8B + Qwen3 7B: Any GPU with 8GB VRAM (or CPU for dev)

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
| Grafana | http://localhost:3001 | Claims dashboard, fraud trends |
| Jaeger | http://localhost:16686 | Distributed traces |
| Prometheus | http://localhost:9090 | Raw metrics |
| AI Metrics | http://localhost:8090/internal/ai/metrics | Prometheus scrape endpoint |

Key metrics:
- `hfcx_ai_claims_processed_total` — throughput
- `hfcx_ai_adjudication_decisions_total{decision="approved"}` — approval rate
- `hfcx_ai_agent_latency_seconds{agent="fraud_detection"}` — per-agent latency
- `hfcx_ai_fraud_high_risk_total` — fraud alerts
- `hfcx_ai_kafka_consumer_lag` — processing backlog

---

## Phased Rollout (SRS Appendix C)

| Phase | Weeks | Scope |
|-------|-------|-------|
| **Phase 0** | 1-2 | Infrastructure: Kafka bridge, LiteLLM, Ollama, monitoring |
| **Phase 1** | 3-8 | Eligibility caching + ICD-10 validation (human-in-the-loop) |
| **Phase 2** | 9-16 | Fraud detection + SIU portal (unsupervised → supervised) |
| **Phase 3** | 17-24 | Medical necessity + EDA RAG (pre-auth workflow) |
| **Phase 4** | 25-32 | Supervisor dashboard + FRA regulatory reporting |
| **Phase 5** | Ongoing | Pattern learning, monthly model retraining |

---

## Security

- **SEC-001**: Keycloak service-to-service JWT on all internal endpoints
- **SEC-002**: JWE encryption preserved — AI operates on pre-decrypted FHIR bundles within trusted pipeline
- **SEC-003**: `ai_audit_log` is append-only (PostgreSQL rules), monthly partitioned for FRA compliance
- **SEC-004**: Model weights stored encrypted in MinIO (SSE-S3)
- **SEC-005**: PHI redacted from all logs — only claim correlation IDs logged

---

## License

MIT © HealthFlow Group 2026

---

*Built on: LangGraph (MIT), LiteLLM (MIT), MedGemma (Open HAI-DEF), ChromaDB (Apache 2.0),
scikit-learn (BSD-3), XGBoost (Apache 2.0), PyOD (BSD-2), NetworkX (BSD-3),
FastAPI (MIT), aiokafka (Apache 2.0)*
