# hfcx-ai-claims — Database migrations

Two complementary paths are supported:

## 1. `init.sql` — quick bootstrap for local dev

Runs on first `docker compose up` via the Postgres init hook. Mirrors
the current state of `head` so new developers get a working schema
without installing alembic.

## 2. `alembic/` — versioned migrations for staging / production

```bash
# Apply all pending migrations
alembic upgrade head

# Roll back the most recent migration
alembic downgrade -1

# Create a new migration from ORM changes
alembic revision --autogenerate -m "add new column"
```

### Revision history

| Revision | Description |
|---|---|
| `20260409_0001` | Baseline — mirrors `init.sql` (SRS §5.1, 5.2, 5.3 + FR-FD-002 dedup table) |
| `20260409_0002` | `pg_partman` setup for `ai_audit_log` monthly auto-partitioning |

### pg_partman

Production Postgres should install the `pg_partman` extension and
enable either `pg_partman_bgw` or a `pg_cron` job running
`SELECT partman.run_maintenance_proc()` every 10 minutes.

Migration `0002` is a no-op when `pg_partman` is unavailable, so dev
environments without the extension still migrate cleanly. The
`init.sql` path pre-creates 12 months of partitions for 2026 as a
fallback.

### SRS mapping

- **SRS §5.1** `ai_claim_analysis` — primary AI analysis record per claim
- **SRS §5.2** `ai_agent_memory` — cross-claim pattern learning (L2 store for `FR-SM-001`)
- **SRS §5.3** `ai_audit_log` — append-only FRA audit trail (`SEC-003`)
- **FR-FD-002** `ai_claim_duplicate` — cross-payer duplicate detection hash index
