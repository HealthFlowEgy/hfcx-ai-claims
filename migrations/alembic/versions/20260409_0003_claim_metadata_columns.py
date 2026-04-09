"""add denormalized claim metadata to ai_claim_analysis

Closes P0 review finding: the BFF dashboards had no way to surface
provider, payer, claim type, or amount without joining the HFCX
platform claims table cross-service. The claim-analysis writer
populates these columns on every coordinator run so the Next.js
portals can render meaningful rows.

SEC-005: patient NID is stored as a SHA-256 hash plus a display-only
masked form (e.g. ``**********4567``). The raw National ID is never
persisted.

Revision ID: 20260409_0003
Revises: 20260409_0002
Create Date: 2026-04-09
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260409_0003"
down_revision: str | None = "20260409_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_claim_analysis",
        sa.Column("provider_id", sa.String(128), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("payer_id", sa.String(128), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("claim_type", sa.String(32), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("patient_nid_hash", sa.String(64), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("patient_nid_masked", sa.String(32), nullable=True),
    )
    op.add_column(
        "ai_claim_analysis",
        sa.Column("service_date", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "idx_ai_claim_analysis_provider_id",
        "ai_claim_analysis",
        ["provider_id"],
    )
    op.create_index(
        "idx_ai_claim_analysis_payer_id",
        "ai_claim_analysis",
        ["payer_id"],
    )
    op.create_index(
        "idx_ai_claim_analysis_claim_type",
        "ai_claim_analysis",
        ["claim_type"],
    )
    op.create_index(
        "idx_ai_claim_analysis_patient_nid_hash",
        "ai_claim_analysis",
        ["patient_nid_hash"],
    )


def downgrade() -> None:
    op.drop_index("idx_ai_claim_analysis_patient_nid_hash", table_name="ai_claim_analysis")
    op.drop_index("idx_ai_claim_analysis_claim_type", table_name="ai_claim_analysis")
    op.drop_index("idx_ai_claim_analysis_payer_id", table_name="ai_claim_analysis")
    op.drop_index("idx_ai_claim_analysis_provider_id", table_name="ai_claim_analysis")
    op.drop_column("ai_claim_analysis", "service_date")
    op.drop_column("ai_claim_analysis", "patient_nid_masked")
    op.drop_column("ai_claim_analysis", "patient_nid_hash")
    op.drop_column("ai_claim_analysis", "total_amount")
    op.drop_column("ai_claim_analysis", "claim_type")
    op.drop_column("ai_claim_analysis", "payer_id")
    op.drop_column("ai_claim_analysis", "provider_id")
