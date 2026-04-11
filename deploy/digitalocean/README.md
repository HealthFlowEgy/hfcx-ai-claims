# DigitalOcean Deployment Guide — HFCX AI Claims

This guide covers the complete deployment of the HFCX AI Claims platform on DigitalOcean, including infrastructure provisioning, CI/CD pipeline, Kubernetes manifests, and day-2 operations.

---

## Architecture on DigitalOcean

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DigitalOcean Cloud                               │
│                                                                         │
│  ┌──────────────┐     ┌─────────────────────────────────────────────┐  │
│  │  DO DNS /     │     │  DOKS Cluster (hfcx-ai-claims-{env})       │  │
│  │  Cloudflare   │────▶│                                             │  │
│  └──────────────┘     │  ┌─────────┐  ┌──────────┐  ┌───────────┐  │  │
│                        │  │ nginx   │  │ cert-    │  │ Prometheus│  │  │
│  ┌──────────────┐     │  │ ingress │  │ manager  │  │ + Grafana │  │  │
│  │  DOCR         │     │  └────┬────┘  └──────────┘  └───────────┘  │  │
│  │  (Container   │     │       │                                     │  │
│  │   Registry)   │     │  ┌────▼────────────────────────────────┐   │  │
│  └──────────────┘     │  │  hcx-ai namespace                    │   │  │
│                        │  │                                      │   │  │
│  ┌──────────────┐     │  │  ┌──────────┐  ┌──────────────────┐  │   │  │
│  │  Managed      │◀───│──│──│ API (×3)  │  │ Consumer (×3-15) │  │   │  │
│  │  PostgreSQL   │     │  │  └──────────┘  └──────────────────┘  │   │  │
│  │  15           │     │  │  ┌──────────┐  ┌──────────────────┐  │   │  │
│  └──────────────┘     │  │  │Frontend  │  │ Ollama + LiteLLM │  │   │  │
│                        │  │  │ (×2-6)   │  │ (LLM inference)  │  │   │  │
│  ┌──────────────┐     │  │  └──────────┘  └──────────────────┘  │   │  │
│  │  Managed      │◀───│──│  ┌──────────┐  ┌──────────────────┐  │   │  │
│  │  Redis 7      │     │  │  │ Redpanda │  │ ChromaDB (RAG)   │  │   │  │
│  └──────────────┘     │  │  │ (Kafka)  │  │                  │  │   │  │
│                        │  │  └──────────┘  └──────────────────┘  │   │  │
│  ┌──────────────┐     │  └──────────────────────────────────────┘   │  │
│  │  Spaces (S3)  │     │                                             │  │
│  │  Model weights│     └─────────────────────────────────────────────┘  │
│  └──────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Cost Estimate

| Resource | Spec | Monthly Cost |
|----------|------|-------------|
| DOKS Cluster (control plane) | Free | $0 |
| Worker nodes (3 x s-4vcpu-8gb) | 4 vCPU, 8 GB each | $144 |
| Managed PostgreSQL (db-s-2vcpu-4gb) | 2 vCPU, 4 GB, 38 GB disk | $60 |
| Managed Redis (db-s-1vcpu-2gb) | 1 vCPU, 2 GB | $30 |
| Container Registry (Starter) | 5 repos, 5 GB | $5 |
| Load Balancer | 1 unit | $12 |
| Block Storage (5 PVCs, ~105 GB) | Redpanda 20G + Chroma 10G + Ollama 50G + Prometheus 20G + Grafana 5G | $10.50 |
| Spaces (model weights) | 250 GB | $5 |
| **Staging Total** | | **~$267/mo** |
| GPU node (production, optional) | gpu-h100x1-80gb | +$3,299/mo |

---

## Prerequisites

1. **DigitalOcean account** with API token (read+write scope)
2. **doctl CLI** installed: [install guide](https://docs.digitalocean.com/reference/doctl/how-to/install/)
3. **kubectl** installed: `brew install kubectl` or `snap install kubectl`
4. **Helm 3** installed: `brew install helm` or `snap install helm`
5. **GitHub repository** with admin access for secrets

---

## Step 1: Provision Infrastructure

```bash
export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."

# Staging (default)
chmod +x deploy/digitalocean/provision.sh
./deploy/digitalocean/provision.sh --region fra1 --env staging

# Production
./deploy/digitalocean/provision.sh --region fra1 --env production
```

The script creates: DOCR registry, DOKS cluster, Managed PostgreSQL 15, Managed Redis 7, and Spaces bucket.

---

## Step 2: Install Cluster Add-ons

After provisioning, install nginx-ingress and cert-manager:

```bash
# Ensure kubectl points to the right cluster
doctl kubernetes cluster kubeconfig save hfcx-ai-claims-staging

# nginx-ingress controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.publishService.enabled=true \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/do-loadbalancer-name"="hfcx-ingress-lb"

# cert-manager (for Let's Encrypt TLS)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# Verify
kubectl get pods -n ingress-nginx
kubectl get pods -n cert-manager
```

---

## Step 3: Deploy Supporting Services

```bash
# Create namespace
kubectl create namespace hcx-ai

# Deploy Redpanda, ChromaDB, LiteLLM, Ollama, Prometheus, Grafana, Jaeger
kubectl apply -f deploy/digitalocean/k8s/supporting-services.yaml

# Wait for all pods
kubectl get pods -n hcx-ai -w
```

### Pull LLM Models (one-time)

```bash
# Port-forward to Ollama
kubectl port-forward svc/ollama 11434:11434 -n hcx-ai &

# Pull required models
curl -X POST http://localhost:11434/api/pull -d '{"name": "medgemma:27b"}'
curl -X POST http://localhost:11434/api/pull -d '{"name": "llama3:8b-instruct"}'
curl -X POST http://localhost:11434/api/pull -d '{"name": "qwen3:7b"}'
```

### Seed ChromaDB (one-time)

```bash
# Port-forward to ChromaDB
kubectl port-forward svc/chromadb 8000:8000 -n hcx-ai &

# Run seeder
pip install chromadb
python scripts/seed_chromadb.py
```

---

## Step 4: Configure GitHub Secrets

Navigate to **Settings > Secrets and variables > Actions** in your GitHub repo and add:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API token | `dop_v1_...` |
| `DIGITALOCEAN_CLUSTER_NAME` | DOKS cluster name | `hfcx-ai-claims-staging` |
| `DATABASE_URL` | Managed PG connection string | `postgresql+asyncpg://user:pass@host:25060/hfcx_ai?sslmode=require` |
| `REDIS_URL` | Managed Redis connection string | `rediss://default:pass@host:25061/0` |
| `SECRET_KEY` | App secret (32+ chars) | `$(openssl rand -hex 32)` |
| `KEYCLOAK_CLIENT_SECRET` | Keycloak service account | (from Keycloak admin) |
| `LITELLM_API_KEY` | LiteLLM gateway key | `sk-internal-hfcx` |

### Get connection strings from DO:

```bash
# PostgreSQL
DB_ID=$(doctl databases list --format ID,Name --no-header | grep "pg-staging" | awk '{print $1}')
doctl databases connection $DB_ID --format URI --no-header

# Redis
REDIS_ID=$(doctl databases list --format ID,Name --no-header | grep "redis-staging" | awk '{print $1}')
doctl databases connection $REDIS_ID --format URI --no-header
```

---

## Step 5: Deploy (Automatic)

The GitHub Actions workflow triggers automatically on push to `main`:

```
Push to main → Test → Build images → Push to DOCR → Migrate DB → Deploy to DOKS
```

### Manual deployment:

```bash
# Via GitHub Actions (recommended)
gh workflow run deploy-digitalocean.yml \
  -f environment=staging \
  -f skip_tests=false

# Via kubectl (emergency)
export BACKEND_IMG="registry.digitalocean.com/hfcx-registry/hfcx-ai-claims-backend:latest"
export FRONTEND_IMG="registry.digitalocean.com/hfcx-registry/hfcx-ai-claims-frontend:latest"
export ENVIRONMENT="staging"
envsubst < deploy/digitalocean/k8s/backend.yaml | kubectl apply -f -
envsubst < deploy/digitalocean/k8s/frontend.yaml | kubectl apply -f -
kubectl apply -f deploy/digitalocean/k8s/services.yaml
kubectl apply -f deploy/digitalocean/k8s/ingress.yaml
```

---

## Step 6: DNS Configuration

Point your domain to the DigitalOcean Load Balancer IP:

```bash
# Get the LB external IP
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

| Record | Type | Value |
|--------|------|-------|
| `portal.claim.healthflow.tech` | A | `<LB_IP>` |
| `api.claim.healthflow.tech` | A | `<LB_IP>` |
| `monitoring.claim.healthflow.tech` | A | `<LB_IP>` |

---

## Day-2 Operations

### Scaling

```bash
# Manual scale
kubectl scale deployment hfcx-ai-api -n hcx-ai --replicas=5

# HPA is configured automatically:
#   API:      3–10 pods (70% CPU)
#   Consumer: 3–15 pods (70% CPU)
#   Frontend: 2–6  pods (70% CPU)

# Add DOKS nodes
doctl kubernetes cluster node-pool update hfcx-ai-claims-staging general \
  --count 5 --max-nodes 8
```

### Rollback

```bash
# View rollout history
kubectl rollout history deployment/hfcx-ai-api -n hcx-ai

# Rollback to previous version
kubectl rollout undo deployment/hfcx-ai-api -n hcx-ai

# Rollback to specific revision
kubectl rollout undo deployment/hfcx-ai-api -n hcx-ai --to-revision=3
```

### Logs

```bash
# API logs
kubectl logs -f deployment/hfcx-ai-api -n hcx-ai --tail=100

# Consumer logs
kubectl logs -f deployment/hfcx-ai-consumer -n hcx-ai --tail=100

# All pods
kubectl logs -l app.kubernetes.io/name=hfcx-ai-claims -n hcx-ai --tail=50
```

### Database Operations

```bash
# Connect to managed PostgreSQL
DB_ID=$(doctl databases list --format ID,Name --no-header | grep "pg-staging" | awk '{print $1}')
doctl databases connection $DB_ID

# Run migrations manually
export DATABASE_URL="postgresql+asyncpg://..."
alembic upgrade head

# Backup (automatic daily by DO, manual snapshot)
doctl databases backups list $DB_ID
```

### Monitoring

```bash
# Port-forward Grafana
kubectl port-forward svc/grafana 3000:3000 -n hcx-ai

# Port-forward Prometheus
kubectl port-forward svc/prometheus 9090:9090 -n hcx-ai

# Port-forward Jaeger
kubectl port-forward svc/jaeger 16686:16686 -n hcx-ai
```

### Key Prometheus Metrics

| Metric | Description |
|--------|-------------|
| `hfcx_claims_processed_total` | Total claims processed by agent |
| `hfcx_claim_latency_seconds` | End-to-end processing latency |
| `hfcx_fraud_score_histogram` | Fraud score distribution |
| `hfcx_model_drift_score` | Model drift detection score |
| `hfcx_circuit_breaker_state` | Circuit breaker state (0=closed, 1=open) |
| `hfcx_kafka_consumer_lag` | Kafka consumer lag |

---

## Teardown

```bash
# Remove a specific environment
export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."
chmod +x deploy/digitalocean/teardown.sh
./deploy/digitalocean/teardown.sh --env staging --confirm

# Remove everything including registry
doctl registry delete --force
```

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| Pods stuck in `Pending` | Insufficient node resources | Scale node pool: `doctl k8s cluster node-pool update ... --count 4` |
| `ImagePullBackOff` | DOCR not connected to cluster | `doctl kubernetes cluster registry add <cluster>` |
| DB connection refused | Firewall / trusted sources | Add DOKS cluster to DB trusted sources in DO console |
| LB IP not assigned | LB quota or annotation error | Check `kubectl describe svc hfcx-ai-lb -n hcx-ai` |
| TLS cert not issued | cert-manager solver failed | Check `kubectl describe certificate -n hcx-ai` and DNS |
| Ollama OOM | Model too large for node | Use GPU node pool or smaller model variant |
| High latency | Consumer lag building up | Scale consumer replicas or check LLM response times |

---

## File Reference

```
deploy/digitalocean/
├── README.md                          ← This guide
├── provision.sh                       ← Infrastructure provisioning script
├── teardown.sh                        ← Infrastructure teardown script
└── k8s/
    ├── backend.yaml                   ← API + Consumer deployments, HPA, ConfigMap
    ├── frontend.yaml                  ← Frontend deployment + HPA
    ├── services.yaml                  ← ClusterIP, LoadBalancer, PDBs
    ├── ingress.yaml                   ← nginx-ingress + cert-manager + TLS
    └── supporting-services.yaml       ← Redpanda, ChromaDB, LiteLLM, Ollama, monitoring

.github/workflows/
└── deploy-digitalocean.yml            ← CI/CD pipeline (test → build → migrate → deploy)
```
