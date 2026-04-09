-- ─────────────────────────────────────────────────────────────────────────────
-- HFCX AI Claims Layer — PostgreSQL Schema (SRS Section 5)
-- Run by Docker entrypoint on first startup, or via Alembic in production.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_partman";   -- Monthly partitioning for audit log

-- ── ai_claim_analysis (SRS 5.1) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_claim_analysis (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id              VARCHAR(128) NOT NULL,
    correlation_id        VARCHAR(128) NOT NULL,
    hcx_workflow_id       VARCHAR(128),

    eligibility_result    JSONB,
    coding_result         JSONB,
    fraud_result          JSONB,
    necessity_result      JSONB,

    adjudication_decision VARCHAR(20),
    overall_confidence    FLOAT,
    requires_human_review BOOLEAN     DEFAULT FALSE,
    human_review_reasons  JSONB       DEFAULT '[]',

    fraud_score           FLOAT,
    fraud_risk_level      VARCHAR(20),

    processing_time_ms    INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,

    CONSTRAINT uq_claim_correlation UNIQUE (claim_id, correlation_id)
);

CREATE INDEX idx_ai_claim_analysis_claim_id       ON ai_claim_analysis(claim_id);
CREATE INDEX idx_ai_claim_analysis_correlation_id ON ai_claim_analysis(correlation_id);
CREATE INDEX idx_ai_claim_analysis_decision        ON ai_claim_analysis(adjudication_decision);
CREATE INDEX idx_ai_claim_analysis_fraud_score     ON ai_claim_analysis(fraud_score);
CREATE INDEX idx_ai_claim_analysis_created_at      ON ai_claim_analysis(created_at DESC);
CREATE INDEX idx_ai_claim_analysis_human_review    ON ai_claim_analysis(requires_human_review)
    WHERE requires_human_review = TRUE;

-- ── ai_agent_memory (SRS 5.2) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent_memory (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name            VARCHAR(64) NOT NULL,
    pattern_key           VARCHAR(256) NOT NULL,
    pattern_value         JSONB        NOT NULL,
    confidence            FLOAT,
    occurrence_count      INTEGER      DEFAULT 1,
    last_seen_claim_id    VARCHAR(128),

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at            TIMESTAMPTZ,

    CONSTRAINT uq_agent_pattern UNIQUE (agent_name, pattern_key)
);

CREATE INDEX idx_ai_agent_memory_agent ON ai_agent_memory(agent_name);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ai_agent_memory_updated_at
    BEFORE UPDATE ON ai_agent_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── ai_audit_log (SRS 5.3) — APPEND-ONLY, monthly partitioned ────────────────
-- Partitioned by created_at (monthly) using pg_partman
CREATE TABLE IF NOT EXISTS ai_audit_log (
    id                    UUID         NOT NULL DEFAULT uuid_generate_v4(),
    event_type            VARCHAR(64)  NOT NULL,
    correlation_id        VARCHAR(128) NOT NULL,
    hcx_correlation_id    VARCHAR(128),
    claim_id_hash         VARCHAR(64),          -- SHA-256 truncated — no raw PHI (SEC-005)

    agent_name            VARCHAR(64),
    action                VARCHAR(128) NOT NULL,
    outcome               VARCHAR(64),
    decision              VARCHAR(20),

    processing_time_ms    INTEGER,
    model_used            VARCHAR(128),
    fraud_risk_level      VARCHAR(20),

    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (created_at);

CREATE INDEX idx_ai_audit_log_correlation_id ON ai_audit_log(correlation_id);
CREATE INDEX idx_ai_audit_log_event_type     ON ai_audit_log(event_type);
CREATE INDEX idx_ai_audit_log_created_at     ON ai_audit_log(created_at DESC);

-- Prevent UPDATE/DELETE on audit log (FRA compliance — SEC-003)
CREATE OR REPLACE RULE ai_audit_log_no_update AS
    ON UPDATE TO ai_audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE ai_audit_log_no_delete AS
    ON DELETE TO ai_audit_log DO INSTEAD NOTHING;

-- Create initial monthly partitions (2026)
CREATE TABLE ai_audit_log_2026_01 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE ai_audit_log_2026_02 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE ai_audit_log_2026_03 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE ai_audit_log_2026_04 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE ai_audit_log_2026_05 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE ai_audit_log_2026_06 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE ai_audit_log_2026_07 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE ai_audit_log_2026_08 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE ai_audit_log_2026_09 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE ai_audit_log_2026_10 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE ai_audit_log_2026_11 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE ai_audit_log_2026_12 PARTITION OF ai_audit_log
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- pg_partman will auto-create future partitions
-- Run: SELECT partman.create_parent('public.ai_audit_log', 'created_at', 'native', 'monthly');
