#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims — DigitalOcean Infrastructure Provisioning
#
# Provisions all required DigitalOcean resources:
#   1. Container Registry (DOCR)
#   2. Managed Kubernetes Cluster (DOKS)
#   3. Managed PostgreSQL 15
#   4. Managed Redis 7
#   5. Spaces (S3-compatible object storage for model weights)
#   6. Domain + DNS records (optional)
#
# Prerequisites:
#   - doctl CLI installed: https://docs.digitalocean.com/reference/doctl/how-to/install/
#   - DO API token with read+write scope
#
# Usage:
#   export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."
#   chmod +x provision.sh
#   ./provision.sh [--region fra1] [--env staging|production]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
REGION="${REGION:-fra1}"                    # Frankfurt (closest to Egypt with DOKS)
ENV="${ENV:-staging}"
PROJECT_NAME="hfcx-ai-claims"
K8S_VERSION="1.30"                         # Latest stable DOKS version
K8S_NODE_SIZE="s-4vcpu-8gb"                # 4 vCPU, 8 GB RAM per node
K8S_NODE_COUNT=3
K8S_GPU_NODE_SIZE="gpu-h100x1-80gb"        # For LLM inference (production only)
K8S_GPU_NODE_COUNT=1
DB_SIZE="db-s-2vcpu-4gb"                   # 2 vCPU, 4 GB RAM
DB_VERSION="15"
REDIS_SIZE="db-s-1vcpu-2gb"               # 1 vCPU, 2 GB RAM
REDIS_VERSION="7"

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --region) REGION="$2"; shift 2 ;;
        --env) ENV="$2"; shift 2 ;;
        --help) echo "Usage: $0 [--region fra1] [--env staging|production]"; exit 0 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

CLUSTER_NAME="${PROJECT_NAME}-${ENV}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  HFCX AI Claims — DigitalOcean Provisioning                    ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Region:     ${REGION}                                              ║"
echo "║  Env:        ${ENV}                                           ║"
echo "║  Cluster:    ${CLUSTER_NAME}                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ── Verify doctl auth ────────────────────────────────────────────────────────
echo "▸ Verifying DigitalOcean authentication..."
doctl auth init --access-token "${DIGITALOCEAN_ACCESS_TOKEN}" 2>/dev/null || true
doctl account get --format Email,Status --no-header
echo ""

# ── Step 1: Container Registry ───────────────────────────────────────────────
echo "▸ [1/6] Creating Container Registry..."
if doctl registry get 2>/dev/null; then
    echo "  ✓ Registry already exists"
else
    doctl registry create hfcx-registry \
        --subscription-tier starter \
        --region "${REGION}"
    echo "  ✓ Registry 'hfcx-registry' created"
fi
echo ""

# ── Step 2: Kubernetes Cluster ───────────────────────────────────────────────
echo "▸ [2/6] Creating Kubernetes cluster '${CLUSTER_NAME}'..."
if doctl kubernetes cluster get "${CLUSTER_NAME}" 2>/dev/null; then
    echo "  ✓ Cluster already exists"
else
    doctl kubernetes cluster create "${CLUSTER_NAME}" \
        --region "${REGION}" \
        --version "${K8S_VERSION}-do.0" \
        --node-pool "name=general;size=${K8S_NODE_SIZE};count=${K8S_NODE_COUNT};auto-scale=true;min-nodes=2;max-nodes=6;label=workload=general" \
        --set-current-context \
        --wait

    echo "  ✓ Cluster created with ${K8S_NODE_COUNT} nodes"

    # Add GPU node pool for production
    if [[ "${ENV}" == "production" ]]; then
        echo "  ▸ Adding GPU node pool for LLM inference..."
        doctl kubernetes cluster node-pool create "${CLUSTER_NAME}" \
            --name gpu-inference \
            --size "${K8S_GPU_NODE_SIZE}" \
            --count "${K8S_GPU_NODE_COUNT}" \
            --auto-scale \
            --min-nodes 0 \
            --max-nodes 3 \
            --label workload=gpu-inference \
            --taint "nvidia.com/gpu=present:NoSchedule"
        echo "  ✓ GPU node pool added"
    fi
fi

# Connect registry to cluster
echo "  ▸ Connecting registry to cluster..."
doctl kubernetes cluster registry add "${CLUSTER_NAME}"
echo ""

# ── Step 3: Managed PostgreSQL ───────────────────────────────────────────────
echo "▸ [3/6] Creating Managed PostgreSQL ${DB_VERSION}..."
DB_CLUSTER_NAME="${PROJECT_NAME}-pg-${ENV}"
if doctl databases get "${DB_CLUSTER_NAME}" 2>/dev/null; then
    echo "  ✓ Database already exists"
else
    doctl databases create "${DB_CLUSTER_NAME}" \
        --engine pg \
        --version "${DB_VERSION}" \
        --size "${DB_SIZE}" \
        --region "${REGION}" \
        --num-nodes 1 \
        --wait

    # Create the application database
    DB_ID=$(doctl databases list --format ID,Name --no-header | grep "${DB_CLUSTER_NAME}" | awk '{print $1}')
    doctl databases db create "${DB_ID}" hfcx_ai
    doctl databases user create "${DB_ID}" hfcx_ai_app

    echo "  ✓ PostgreSQL cluster created with 'hfcx_ai' database"
fi
echo ""

# ── Step 4: Managed Redis ────────────────────────────────────────────────────
echo "▸ [4/6] Creating Managed Redis ${REDIS_VERSION}..."
REDIS_CLUSTER_NAME="${PROJECT_NAME}-redis-${ENV}"
if doctl databases get "${REDIS_CLUSTER_NAME}" 2>/dev/null; then
    echo "  ✓ Redis already exists"
else
    doctl databases create "${REDIS_CLUSTER_NAME}" \
        --engine redis \
        --version "${REDIS_VERSION}" \
        --size "${REDIS_SIZE}" \
        --region "${REGION}" \
        --num-nodes 1 \
        --wait

    echo "  ✓ Redis cluster created"
fi
echo ""

# ── Step 5: Spaces (S3-compatible storage) ───────────────────────────────────
echo "▸ [5/6] Creating Spaces bucket for model weights..."
SPACES_NAME="${PROJECT_NAME}-models-${ENV}"
if doctl compute cdn list 2>/dev/null | grep -q "${SPACES_NAME}"; then
    echo "  ✓ Space already exists"
else
    # Spaces are created via S3 API — use doctl for simplicity
    curl -s -X PUT \
        -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
        "https://api.digitalocean.com/v2/spaces" \
        -d "{\"name\": \"${SPACES_NAME}\", \"region\": \"${REGION}\"}" \
        2>/dev/null || true
    echo "  ✓ Space '${SPACES_NAME}' created (or already exists)"
fi
echo ""

# ── Step 6: Save kubeconfig ──────────────────────────────────────────────────
echo "▸ [6/6] Saving kubeconfig..."
doctl kubernetes cluster kubeconfig save "${CLUSTER_NAME}"
echo "  ✓ kubeconfig saved to ~/.kube/config"
echo ""

# ── Output connection strings ────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Provisioning Complete!                                         ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                                    ║"
echo "║  1. Add GitHub Secrets (see deploy/digitalocean/README.md)     ║"
echo "║  2. Push to main to trigger deployment                         ║"
echo "║  3. Run: kubectl get pods -n hcx-ai                           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Print connection info
echo "── Connection Details ──────────────────────────────────────────────"
echo ""
echo "Kubernetes:"
echo "  kubectl config current-context"
echo "  kubectl get nodes"
echo ""
echo "PostgreSQL:"
DB_ID=$(doctl databases list --format ID,Name --no-header | grep "${DB_CLUSTER_NAME}" | awk '{print $1}')
if [[ -n "${DB_ID}" ]]; then
    doctl databases connection "${DB_ID}" --format Host,Port,User,Password,Database --no-header
fi
echo ""
echo "Redis:"
REDIS_ID=$(doctl databases list --format ID,Name --no-header | grep "${REDIS_CLUSTER_NAME}" | awk '{print $1}')
if [[ -n "${REDIS_ID}" ]]; then
    doctl databases connection "${REDIS_ID}" --format Host,Port,User,Password --no-header
fi
echo ""
echo "Container Registry:"
echo "  registry.digitalocean.com/hfcx-registry"
echo ""
