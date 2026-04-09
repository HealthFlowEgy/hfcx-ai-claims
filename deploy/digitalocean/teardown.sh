#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HFCX AI Claims — DigitalOcean Teardown
# Removes all provisioned resources. USE WITH CAUTION.
#
# Usage:
#   export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."
#   ./teardown.sh [--env staging|production] [--confirm]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV="${ENV:-staging}"
CONFIRM=false
PROJECT_NAME="hfcx-ai-claims"

while [[ $# -gt 0 ]]; do
    case $1 in
        --env) ENV="$2"; shift 2 ;;
        --confirm) CONFIRM=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

CLUSTER_NAME="${PROJECT_NAME}-${ENV}"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ⚠️  DESTRUCTIVE: Tearing down ${ENV} environment              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

if [[ "${CONFIRM}" != "true" ]]; then
    read -rp "Type 'yes-destroy-${ENV}' to confirm: " answer
    if [[ "${answer}" != "yes-destroy-${ENV}" ]]; then
        echo "Aborted."
        exit 1
    fi
fi

echo "▸ Deleting Kubernetes cluster '${CLUSTER_NAME}'..."
doctl kubernetes cluster delete "${CLUSTER_NAME}" --force --dangerous 2>/dev/null || echo "  (not found)"

echo "▸ Deleting PostgreSQL '${PROJECT_NAME}-pg-${ENV}'..."
DB_ID=$(doctl databases list --format ID,Name --no-header 2>/dev/null | grep "${PROJECT_NAME}-pg-${ENV}" | awk '{print $1}')
if [[ -n "${DB_ID}" ]]; then
    doctl databases delete "${DB_ID}" --force
fi

echo "▸ Deleting Redis '${PROJECT_NAME}-redis-${ENV}'..."
REDIS_ID=$(doctl databases list --format ID,Name --no-header 2>/dev/null | grep "${PROJECT_NAME}-redis-${ENV}" | awk '{print $1}')
if [[ -n "${REDIS_ID}" ]]; then
    doctl databases delete "${REDIS_ID}" --force
fi

echo ""
echo "✓ Teardown complete. Registry preserved (shared across environments)."
echo "  To delete registry: doctl registry delete --force"
