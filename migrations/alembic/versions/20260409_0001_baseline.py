"""baseline — mirror migrations/init.sql

Creates the three SRS §5 tables (ai_claim_analysis, ai_agent_memory,
ai_audit_log) plus the FR-FD-002 cross-payer duplicate table. All
indexes, triggers, and partition metadata match migrations/init.sql so
existing dev environments already at HEAD won't re-run this.

Revision ID: 20260409_0001
Revises:
Create Date: 2026-04-09
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "20260409_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    # ── ai_claim_analysis (SRS 5.1) ──────────────────────────────────────
    op.create_table(
        "ai_claim_analysis",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("claim_id", sa.String(128), nullable=False),
        sa.Column("correlation_id", sa.String(128), nullable=False),
        sa.Column("hcx_workflow_id", sa.String(128)),
        sa.Column(
            "risk_score",
            sa.Numeric(3, 2),
        ),
        sa.Column("recommendation", sa.String(16)),
        sa.Column("confidence", sa.Numeric(3, 2)),
        sa.Column("eligibility_result", JSONB),
        sa.Column("coding_result", JSONB),
        sa.Column("fraud_result", JSONB),
        sa.Column("necessity_result", JSONB),
        sa.Column("adjudication_decision", sa.String(20)),
        sa.Column("overall_confidence", sa.Float),
        sa.Column(
            "requires_human_review", sa.Boolean, server_default=sa.text("false")
        ),
        sa.Column("human_review_reasons", JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("fraud_score", sa.Float),
        sa.Column("fraud_risk_level", sa.String(20)),
        sa.Column("model_versions", JSONB),
        sa.Column("processing_time_ms", sa.Integer),
        # ISSUE-005: Add missing denormalized columns to match init.sql
        sa.Column("provider_id", sa.String(128)),
        sa.Column("payer_id", sa.String(128)),
        sa.Column("claim_type", sa.String(32)),
        sa.Column("total_amount", sa.Numeric(12, 2)),
        sa.Column("patient_nid_hash", sa.String(64)),
        sa.Column("patient_nid_masked", sa.String(20)),
        sa.Column("service_date", sa.Date),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 1)",
            name="ck_risk_score_range",
        ),
        sa.CheckConstraint(
            "recommendation IS NULL OR recommendation IN "
            "('approve','deny','investigate')",
            name="ck_recommendation_enum",
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_confidence_range",
        ),
        sa.UniqueConstraint(
            "claim_id", "correlation_id", name="uq_claim_correlation"
        ),
    )
    op.create_index(
        "idx_ai_claim_analysis_claim_id", "ai_claim_analysis", ["claim_id"]
    )
    op.create_index(
        "idx_ai_claim_analysis_correlation_id",
        "ai_claim_analysis",
        ["correlation_id"],
    )
    op.create_index(
        "idx_ai_claim_analysis_decision",
        "ai_claim_analysis",
        ["adjudication_decision"],
    )
    op.create_index(
        "idx_ai_claim_analysis_fraud_score",
        "ai_claim_analysis",
        ["fraud_score"],
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_claim_analysis_created_at "
        "ON ai_claim_analysis(created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_claim_analysis_human_review "
        "ON ai_claim_analysis(requires_human_review) "
        "WHERE requires_human_review = TRUE"
    )

    # ── ai_agent_memory (SRS 5.2) ────────────────────────────────────────
    op.create_table(
        "ai_agent_memory",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("agent_name", sa.String(64), nullable=False),
        sa.Column("pattern_type", sa.String(32), nullable=False),
        sa.Column("pattern_key", sa.String(256), nullable=False),
        sa.Column("pattern_data", JSONB, nullable=False),
        sa.Column("confidence", sa.Numeric(3, 2)),
        sa.Column(
            "occurrence_count",
            sa.Integer,
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("last_claim_id", sa.String(128)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "pattern_type IN ('fraud_signal','coding_error',"
            "'denial_pattern','provider_anomaly')",
            name="ck_pattern_type_enum",
        ),
        sa.UniqueConstraint("agent_name", "pattern_key", name="uq_agent_pattern"),
    )
    op.create_index("idx_ai_agent_memory_agent", "ai_agent_memory", ["agent_name"])
    op.create_index(
        "idx_ai_agent_memory_pattern_type",
        "ai_agent_memory",
        ["pattern_type"],
    )

    # ── ai_claim_duplicate (FR-FD-002) ───────────────────────────────────
    op.create_table(
        "ai_claim_duplicate",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("dup_hash", sa.CHAR(64), nullable=False),
        sa.Column("claim_correlation_id", sa.String(128), nullable=False),
        sa.Column("provider_id", sa.String(128)),
        sa.Column("payer_id", sa.String(128)),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index(
        "idx_ai_claim_duplicate_hash_recent",
        "ai_claim_duplicate",
        ["dup_hash", sa.text("observed_at DESC")],
    )

    # ── ai_audit_log (SRS 5.3) — partitioned ─────────────────────────────
    # alembic doesn't natively support PARTITION BY in create_table; use raw SQL.
    op.execute(
        """
        CREATE TABLE ai_audit_log (
            log_id                BIGSERIAL    NOT NULL,
            event_type            VARCHAR(100) NOT NULL,
            claim_correlation_id  VARCHAR(128) NOT NULL,
            claim_id_hash         VARCHAR(64),
            agent_name            VARCHAR(100),
            action_detail         JSONB        NOT NULL,
            processing_time_ms    INTEGER,
            model_used            VARCHAR(128),
            fraud_risk_level      VARCHAR(20),
            decision              VARCHAR(20),
            created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            PRIMARY KEY (log_id, created_at)
        ) PARTITION BY RANGE (created_at)
        """
    )
    op.execute(
        "CREATE INDEX idx_ai_audit_log_correlation_id "
        "ON ai_audit_log(claim_correlation_id)"
    )
    op.execute(
        "CREATE INDEX idx_ai_audit_log_event_type ON ai_audit_log(event_type)"
    )
    op.execute(
        "CREATE INDEX idx_ai_audit_log_created_at "
        "ON ai_audit_log(created_at DESC)"
    )

    # Append-only enforcement (SEC-003).
    op.execute(
        "CREATE OR REPLACE RULE ai_audit_log_no_update AS "
        "ON UPDATE TO ai_audit_log DO INSTEAD NOTHING"
    )
    op.execute(
        "CREATE OR REPLACE RULE ai_audit_log_no_delete AS "
        "ON DELETE TO ai_audit_log DO INSTEAD NOTHING"
    )

    # Initial 12 monthly partitions for 2026. Subsequent months are
    # auto-created by the pg_partman maintenance job (see
    # migrations/alembic/versions/20260409_0002_pg_partman_setup.py).
    for m in range(1, 13):
        start = f"2026-{m:02d}-01"
        end = f"2026-{m + 1:02d}-01" if m < 12 else "2027-01-01"
        op.execute(
            f"CREATE TABLE IF NOT EXISTS ai_audit_log_2026_{m:02d} "
            f"PARTITION OF ai_audit_log "
            f"FOR VALUES FROM ('{start}') TO ('{end}')"
        )

    # ISSUE-050: Add 2027 partitions as safety net
    for m in range(1, 13):
        start = f"2027-{m:02d}-01"
        end = f"2027-{m + 1:02d}-01" if m < 12 else "2028-01-01"
        op.execute(
            f"CREATE TABLE IF NOT EXISTS ai_audit_log_2027_{m:02d} "
            f"PARTITION OF ai_audit_log "
            f"FOR VALUES FROM ('{start}') TO ('{end}')"
        )


def downgrade() -> None:
    op.execute("DROP RULE IF EXISTS ai_audit_log_no_delete ON ai_audit_log")
    op.execute("DROP RULE IF EXISTS ai_audit_log_no_update ON ai_audit_log")
    op.execute("DROP TABLE IF EXISTS ai_audit_log CASCADE")
    op.drop_index(
        "idx_ai_claim_duplicate_hash_recent", table_name="ai_claim_duplicate"
    )
    op.drop_table("ai_claim_duplicate")
    op.drop_index("idx_ai_agent_memory_pattern_type", table_name="ai_agent_memory")
    op.drop_index("idx_ai_agent_memory_agent", table_name="ai_agent_memory")
    op.drop_table("ai_agent_memory")
    op.execute("DROP INDEX IF EXISTS idx_ai_claim_analysis_human_review")
    op.execute("DROP INDEX IF EXISTS idx_ai_claim_analysis_created_at")
    op.drop_index(
        "idx_ai_claim_analysis_fraud_score", table_name="ai_claim_analysis"
    )
    op.drop_index("idx_ai_claim_analysis_decision", table_name="ai_claim_analysis")
    op.drop_index(
        "idx_ai_claim_analysis_correlation_id", table_name="ai_claim_analysis"
    )
    op.drop_index("idx_ai_claim_analysis_claim_id", table_name="ai_claim_analysis")
    op.drop_table("ai_claim_analysis")
