# HFCX AI Claims — DevOps Guide

> Audience: **GitHub/DevOps engineers** operating
> `healthflowegy/hfcx-ai-claims` in production.
> Scope: CI, deployments, secrets, branch protection, monitoring,
> release process, and the incident-response runbook. Companion to
> `docs/SRS-HealthFlow-HCX-AI-v2.0-Enhanced.docx` and
> `docs/SRS-HealthFlow-HCX-Frontend-Portals-v1.0.docx`.

The repository houses two deployables:

- **Backend** (`src/`) — FastAPI service + Kafka consumer, Python 3.11.
- **Frontend** (`frontend/`) — Next.js 14 portal (Provider / Payer /
  SIU / Regulatory), TypeScript, deployed as a standalone container.

Both ship from the same branch. CI runs them in parallel; deployments
are independent but share the same GitOps repo.

---

## 1. Repository layout

```
hfcx-ai-claims/
├── src/                    # Backend (FastAPI + LangGraph)
├── frontend/               # Next.js portals
├── migrations/
│   ├── init.sql            # Dev bootstrap (docker-compose)
│   └── alembic/            # Versioned migrations (staging + prod)
├── k8s/manifests.yaml      # Backend Kubernetes manifests
├── config/                 # LiteLLM, Prometheus
├── docs/                   # SRS documents + this DevOps guide
├── tests/                  # pytest suite (unit + integration)
└── .github/workflows/ci.yml
```

---

## 2. Branches and protection rules

### Required GitHub branch-protection settings on `main`

| Setting | Value |
|---|---|
| Require PR before merging | ✅ |
| Require approvals | 1 |
| Dismiss stale reviews on new commit | ✅ |
| Require review from Code Owners | ✅ |
| Require status checks | ✅ (see list below) |
| Require branches up to date before merging | ✅ |
| Require conversation resolution | ✅ |
| Require linear history | ✅ |
| Require signed commits | ✅ (recommended) |
| Restrict who can push | `healthflowegy/backend-maintainers` |

### Required status checks

All of these must be green before a PR can merge:

```
CI / Lint (ruff)
CI / Type Check (mypy)
CI / Tests (pytest)
CI / Frontend Lint (eslint + tsc)
CI / Frontend Tests (vitest)
CI / Frontend Build
CI / Integration Tests (testcontainers)
CI / Docker Build
```

### Recommended development flow

1. Branch from `main`: `feat/<short-name>` or `fix/<ticket>`.
2. Commit with conventional commits (`feat:`, `fix:`, `ci:`, `docs:`).
3. Open a PR — CI runs all checks in parallel (~6 minutes).
4. Assign a reviewer and wait for ≥1 approval.
5. Squash-merge into `main`. A linear history keeps `git bisect` usable.
6. Tag releases with `v<major>.<minor>.<patch>` — this triggers the
   release workflow (see §6).

---

## 3. GitHub Actions CI pipeline

The pipeline in `.github/workflows/ci.yml` runs on every push and PR.
Jobs fan out in parallel:

| Job | Runs | Purpose |
|---|---|---|
| `lint` | Always | `ruff check src/ tests/` |
| `typecheck` | Always | `mypy src/ --ignore-missing-imports --no-strict-optional` |
| `test` | Always | `pytest tests/` against Redis + Postgres services |
| `integration` | Push to `main` / release tag | testcontainers Redis + Postgres suite |
| `frontend-lint` | Always | `next lint` + `tsc --noEmit` |
| `frontend-test` | Always | `vitest run` |
| `frontend-build` | Always | `next build` (verifies standalone output) |
| `build` | After lint + test | Multi-arch Docker image, pushed to DockerHub on `main` |
| `frontend-build-image` | After frontend-build | Multi-arch Docker image (frontend), pushed on `main` |
| `deploy` | On `main` only | ArgoCD application sync |

### Tuning CI for speed

- **pip cache**: `actions/setup-python@v5` with `cache: pip` saves ~90s.
- **npm cache**: `actions/setup-node@v4` with `cache: npm` saves ~120s.
- **Docker buildx cache**: `type=gha` cache from → to halves image build time.
- **Matrix skipping**: avoid matrix over Python versions; we pin 3.11.
- **Test sharding**: `pytest-xdist -n auto` cuts backend tests from ~7s to ~3s.
- The `integration` job is the slowest (~4 min) — keep it on `needs: lint`
  so it starts immediately rather than after `test`.

### Required CI secrets (`Settings → Secrets and variables → Actions`)

| Name | Scope | Description |
|---|---|---|
| `DOCKER_USERNAME` | Actions secret | DockerHub publisher account |
| `DOCKER_PASSWORD` | Actions secret | DockerHub access token |
| `ARGOCD_SERVER` | Actions secret | ArgoCD API URL |
| `ARGOCD_TOKEN` | Actions secret | ArgoCD sync token |
| `CODECOV_TOKEN` | Actions secret (optional) | Codecov upload |
| `SNYK_TOKEN` | Actions secret (optional) | Snyk vulnerability scan |

---

## 4. Secrets and configuration

### 4.1 Kubernetes Secret lifecycle

Production secrets live in a dedicated vault (recommended:
[External Secrets Operator](https://external-secrets.io/) syncing from
AWS Secrets Manager or HashiCorp Vault). Never commit real secrets to
`k8s/manifests.yaml` — the template there is a placeholder that the
operator replaces with `ExternalSecret` at deploy time.

The Secret must contain:

```
SECRET_KEY                         # App signing key, ≥ 32 chars
DATABASE_URL                       # postgresql+asyncpg://...
REDIS_URL                          # redis://...
KAFKA_BOOTSTRAP_SERVERS            # kafka:9092
LITELLM_BASE_URL                   # http://litellm.hcx-ai.svc:4000
LITELLM_API_KEY
CHROMA_HOST                        # chromadb.hcx-ai.svc
KEYCLOAK_URL                       # https://auth.healthflow.tech
KEYCLOAK_CLIENT_SECRET
NDP_API_URL                        # http://ndp.hcx.svc/ndp/v1
NDP_API_KEY
OTEL_EXPORTER_OTLP_ENDPOINT        # http://otel-collector.monitoring.svc:4317
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
```

### 4.2 Frontend env variables

The frontend is a separate deployment that reads its configuration
from a Kubernetes ConfigMap (non-secret) and a Secret (client secret):

```yaml
# ConfigMap
NEXT_PUBLIC_API_BASE_URL:   https://api.claim.healthflow.tech
NEXT_PUBLIC_APP_ENV:        production
KEYCLOAK_URL:               https://auth.healthflow.tech
KEYCLOAK_REALM:             hcx
KEYCLOAK_CLIENT_ID:         hfcx-frontend

# Secret
KEYCLOAK_CLIENT_SECRET:     <sealed>
SESSION_SECRET:             <sealed, ≥ 32 chars>
```

### 4.3 Rotating secrets

1. Rotate in the upstream vault (AWS Secrets Manager / Vault).
2. ESO picks the change up on its refresh interval (default 1h).
3. Kubernetes rolls pods automatically because the Secret checksum
   annotation in the Deployment template changes.
4. Verify with `kubectl rollout status deploy/hfcx-ai-claims-api -n hcx-ai`.

Keycloak client secret rotation requires a coordinated change: rotate
in Keycloak first, then the frontend Secret, then recycle pods within
1 minute to avoid a login outage window.

---

## 5. Deployments

### 5.1 GitOps (recommended)

We use ArgoCD with two Applications:

- `hfcx-ai-claims-backend` → watches `k8s/backend/` folder.
- `hfcx-ai-claims-frontend` → watches `k8s/frontend/` folder.

Image tags are bumped by [ArgoCD Image Updater](https://argocd-image-updater.readthedocs.io/)
on every `main` push (semver + latest tag). Argo's `auto-sync`
reconciles the live cluster within ~60 seconds.

### 5.2 Manual deployment (break-glass)

```bash
# Backend
kubectl apply -f k8s/manifests.yaml
kubectl -n hcx-ai rollout status deploy/hfcx-ai-claims-api

# Frontend
kubectl apply -f k8s/frontend.yaml
kubectl -n hcx-ai rollout status deploy/hfcx-ai-frontend
```

**Always use GitOps first.** Manual kubectl is a break-glass action
and must be followed by a PR that reconciles the live state back into
`main`.

### 5.3 Database migrations

Alembic migrations ship inside the backend image. Kubernetes runs them
through an init container before the API pods become ready:

```yaml
initContainers:
  - name: db-migrate
    image: healthflow/hfcx-ai-claims:<tag>
    command: ["alembic", "upgrade", "head"]
    envFrom:
      - secretRef:
          name: hfcx-ai-secrets
```

For downgrade / rollback: `alembic downgrade -1` against a pod shell.
Never roll back a destructive migration without a prior `pg_dump`.

### 5.4 Zero-downtime deploys

- **Backend API**: 3 replicas + `maxSurge: 1, maxUnavailable: 0`.
- **Kafka consumer**: 3 replicas + the HPA caps at 6 (partition count).
  During a deploy Kafka rebalances one partition at a time — no events
  are lost because `enable_auto_commit=false` and offsets are committed
  only after successful processing.
- **Frontend**: 3 replicas + `maxSurge: 2, maxUnavailable: 0`.
- **LLM pods** are GPU-pinned — drain GPU nodes before upgrades to
  avoid evicting a running inference mid-claim. Use `nodeSelector`
  and PDBs.

---

## 6. Release workflow

1. Open a release PR on `main`:
   ```
   chore(release): v1.2.0
   ```
2. Update:
   - `src/config.py` `app_version`
   - `frontend/package.json` `version`
   - `CHANGELOG.md`
3. Merge after green CI.
4. Tag:
   ```bash
   git tag -s v1.2.0 -m "v1.2.0"
   git push origin v1.2.0
   ```
5. The `release.yml` workflow:
   - Builds + pushes `healthflow/hfcx-ai-claims:v1.2.0` and `:latest`
   - Builds + pushes `healthflow/hfcx-ai-frontend:v1.2.0` and `:latest`
   - Creates a GitHub Release with the changelog section
   - Triggers ArgoCD sync for the new tag

### Hotfixes

1. Branch from the release tag:
   `git checkout -b fix/urgent-patch v1.2.0`
2. Minimal fix + test.
3. Merge to `main`, then cherry-pick onto the release branch.
4. Tag `v1.2.1`.
5. ArgoCD promotes the tag to production in ~2 minutes.

---

## 7. Monitoring, logging, and alerting

### Prometheus scrape endpoints

- **Backend**: `GET /internal/ai/metrics` (port `8090`)
- **Kafka consumer**: `GET /metrics` (port `8091`)
- **Frontend**: `GET /api/metrics` (port `3000`, minimal runtime stats)

### Key metrics + alert thresholds

| Metric | Alert threshold | PagerDuty |
|---|---|---|
| `hfcx_ai_kafka_consumer_lag` | `> 1000` for 5 min | P1 |
| `hfcx_ai_circuit_breaker_trips_total` | `> 5` in 5 min per breaker | P2 |
| `hfcx_ai_adjudication_decisions_total{decision="pended"}` | spike > 2σ vs 7d baseline | P3 |
| `hfcx_ai_request_latency_seconds{quantile="0.95"}` | `> 8` for 10 min | P1 |
| `hfcx_ai_audit_events_dropped_total` | any > 0 | P1 (FRA compliance) |
| `hfcx_ai_model_drift_score` | `> 0.2` for 6 hours | P2 |

Dashboards live in `config/grafana/` (to be committed as code). Import
them via the Grafana `grafana-dashboards` ConfigMap.

### Logging

- Structured JSON via `structlog` (PHI-redacted per SRS SEC-005).
- Shipped to Loki via the `promtail` DaemonSet.
- Retention: 90 days hot, 2 years cold (S3 archive) per FRA requirement.

### Distributed tracing

OpenTelemetry → Jaeger. Every claim has end-to-end traces from:

```
Provider POST /claim/submit
  → HFCX API Gateway
  → hcx-pipeline-jobs (Scala)
  → Kafka hcx.claims.validated
  → hfcx-ai-claims (FastAPI + LangGraph)
  → Kafka hcx.claims.enriched
  → Payer callback
```

Trace context is propagated across Kafka via W3C Trace Context headers.

---

## 8. Incident-response runbook

### 8.1 "AI layer is down"

Symptoms: `hfcx_ai_kafka_consumer_lag > 10000`, dashboards show
0 claims/min, PagerDuty alert.

1. Check pod status:
   ```bash
   kubectl -n hcx-ai get pods -l app=hfcx-ai-consumer
   kubectl -n hcx-ai get pods -l app=hfcx-ai-claims-api
   ```
2. Check health endpoint:
   ```bash
   kubectl -n hcx-ai port-forward svc/hfcx-ai-claims-api 8090:8090
   curl http://localhost:8090/internal/ai/health
   ```
3. Fail-open: set `AI_BYPASS_ON_FAILURE=true` (already default) —
   claims route to manual queue while the AI layer recovers.
4. Check the circuit breakers — a tripped breaker for LiteLLM means
   the LLM gateway is the root cause, not the AI layer itself.
5. If Redis is down: the LangGraph checkpointer fails. The coordinator
   has a try/except fallback that returns a PENDED decision.
6. If Postgres is down: `ai_claim_analysis` writes fail silently (SEC
   guarantee), audit events drop; start the vault snapshot restore.

### 8.2 "Audit log is filling up"

1. `kubectl -n hcx-ai exec -it postgres-primary -- psql`
2. `SELECT partman.run_maintenance_proc();`
3. Verify retention settings: `SELECT * FROM partman.part_config WHERE parent_table='public.ai_audit_log'`
4. If pg_partman is not installed: manually drop old partitions (see
   `migrations/alembic/versions/20260409_0002_pg_partman_setup.py`).

### 8.3 "Frontend is blank / 502"

1. Check ingress:
   ```bash
   kubectl -n hcx-ai describe ingress hfcx-ai-frontend
   ```
2. Check Keycloak reachability — the middleware redirects to
   `KEYCLOAK_URL` and if that's unreachable users see an infinite
   redirect loop.
3. Check `CORS_ALLOW_ORIGINS` on the backend: must include the
   frontend's public URL.
4. Check the CSP in `next.config.mjs` — if a new third-party script
   was added without updating `connect-src`, the page will blank.
5. Rollback via ArgoCD: `argocd app rollback hfcx-ai-claims-frontend`

### 8.4 "High fraud false-positive rate reported"

1. Pull the drift feedback endpoint:
   ```bash
   curl -s http://<bff>/internal/ai/feedback/stats?model=coordinator
   ```
2. If `precision_fraud < 0.7`, the supervised XGBoost model is likely
   over-predicting fraud. Rollback via `litellm_config.yaml` blue-green.
3. Re-train: trigger the weekly retraining job (separate repo) with the
   latest labeled feedback window.

### 8.5 "Data-sovereignty audit"

Per SRS NFR-003, **zero PHI must leave Egyptian soil**. Verify:

1. Every model in `litellm_config.yaml` has an `api_base` pointing to
   an Egyptian endpoint (no `api.openai.com`, `api.anthropic.com`, etc.).
2. `litellm_settings.telemetry: false` (opt-out of LiteLLM usage reporting).
3. `disable_spend_logs` is `false` for audit but data is stored locally.
4. MinIO, Postgres, Redis, Kafka all run inside the Egypt cluster.
5. All egress allow-lists include only Egyptian IPs.

---

## 9. Security checklist (SRS §8)

| ID | Control | Where enforced |
|---|---|---|
| SEC-001 | Service-to-service JWT on `/internal/ai/*` | `src/api/middleware.py` + Keycloak |
| SEC-002 | JWE encryption preserved end-to-end | HFCX platform (no touch here) |
| SEC-003 | `ai_audit_log` append-only, monthly partitioned | Postgres RULE + pg_partman |
| SEC-004 | Model weights encrypted at rest | MinIO SSE-S3 + `minio_secret_key` |
| SEC-005 | PHI redacted from all logs | `src/utils/phi_redactor.py` + structlog processor |
| (Frontend) | CSP + HSTS + X-Frame | `frontend/next.config.mjs` headers |
| (Frontend) | Portal role matrix | `frontend/lib/session.ts` + `app/page.tsx` |
| (Frontend) | Middleware auth redirect | `frontend/middleware.ts` |

Quarterly: run OWASP ZAP against staging, axe-core against every
portal page, and `cargo audit` / `npm audit` / `pip-audit` on
dependencies.

---

## 10. Appendix — commands cheat sheet

```bash
# Backend
make dev               # docker compose up backend + infra
make test              # pytest + coverage
make lint              # ruff + mypy
alembic upgrade head   # apply latest migration
docker build -t hfcx-ai-claims .

# Frontend
cd frontend
npm install
npm run dev            # next dev on :3000
npm test               # vitest
npm run test:e2e       # playwright (needs backend running)
npm run build          # production build
docker build -t hfcx-ai-frontend .

# Production inspection
kubectl -n hcx-ai logs -l app=hfcx-ai-consumer --tail=200 -f
kubectl -n hcx-ai exec -it deploy/hfcx-ai-claims-api -- python -m src.scripts.health
argocd app get hfcx-ai-claims-backend
argocd app sync hfcx-ai-claims-backend
```
