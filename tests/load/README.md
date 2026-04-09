# Load tests — k6

SRS §9 load tier: `100K claims/day sustained, p95 < 8s E2E`.

## Prerequisites

1. `k6` installed: https://k6.io/docs/get-started/installation/
2. The full stack running locally (`docker compose up -d`) or an
   accessible staging deployment.
3. A service-account JWT with access to `/internal/ai/*` (dev mode
   accepts any bearer token).

## Scripts

### `coordinate_sustained.js`

Sustained-throughput test against `POST /internal/ai/coordinate`.
Targets a rate of 100,000 claims/day — roughly 70 claims/minute at
3 concurrent VUs with a 2.5s per-iteration sleep. Asserts `p95 < 8s`
per SRS NFR-001.

```bash
k6 run \
  -e HFCX_API_URL=http://localhost:8090 \
  -e HFCX_TOKEN=dev-token \
  tests/load/coordinate_sustained.js
```

### `coordinate_burst.js`

Spike test — ramps up to 30 VUs over 60s and stays there for 5
minutes. Checks that the Kafka consumer + coordinator graph survive
a burst of ~1k claims/minute without DLQ growth.

```bash
k6 run \
  -e HFCX_API_URL=http://localhost:8090 \
  -e HFCX_TOKEN=dev-token \
  tests/load/coordinate_burst.js
```

### `agents_fraud_direct.js`

Direct fraud-scoring path (`/internal/ai/agents/fraud/score`) that
bypasses the full coordinator. Useful when isolating fraud detection
regressions from eligibility/coding/necessity.

```bash
k6 run \
  -e HFCX_API_URL=http://localhost:8090 \
  tests/load/agents_fraud_direct.js
```

## Success criteria (all scripts)

- `http_req_failed`      < 1%
- `http_req_duration{p95}` < 8000ms (coordinate), < 2000ms (direct)
- `checks`               pass rate > 99%

These match the Grafana alerting rules in `config/prometheus.yml` so
a local k6 run exercises the same thresholds the production SRE team
watches.
