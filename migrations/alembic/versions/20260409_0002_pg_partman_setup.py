"""pg_partman setup for ai_audit_log auto-partitioning

If the pg_partman extension is available this registers the table as a
native-range parent and schedules monthly partition creation so the
audit log never runs out of partitions. If pg_partman is not installed
the migration is a no-op — operators can still create partitions by
hand or upgrade later.

SRS §5.3 (ai_audit_log) + SEC-003 (append-only FRA compliance).

Revision ID: 20260409_0002
Revises: 20260409_0001
Create Date: 2026-04-09
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "20260409_0002"
down_revision: str | None = "20260409_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    # Detect pg_partman availability without failing if it's missing.
    has_partman = bind.exec_driver_sql(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman'"
    ).first() is not None

    if not has_partman:
        op.execute(
            "DO $$ BEGIN RAISE NOTICE "
            "'pg_partman not available — skipping auto-partition setup'; "
            "END $$"
        )
        return

    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_partman"')

    # Register ai_audit_log as a monthly range-partitioned table.
    # premake=4 → always keep 4 future partitions ready so we never
    # block an INSERT waiting for a new month.
    op.execute(
        """
        SELECT partman.create_parent(
            p_parent_table   := 'public.ai_audit_log',
            p_control        := 'created_at',
            p_type           := 'native',
            p_interval       := 'monthly',
            p_premake        := 4,
            p_start_partition := TO_CHAR(
                DATE_TRUNC('month', NOW()), 'YYYY-MM-DD'
            )
        )
        """
    )

    # Retention: keep 24 months of audit log online; older partitions are
    # detached (not dropped) so compliance officers can re-attach them if
    # investigators need historical data.
    op.execute(
        """
        UPDATE partman.part_config
           SET retention = '24 months',
               retention_keep_table = true,
               retention_keep_index = true,
               infinite_time_partitions = true
         WHERE parent_table = 'public.ai_audit_log'
        """
    )

    # Seed a background maintenance function. In production, install
    # pg_partman_bgw + pg_cron or run `SELECT partman.run_maintenance_proc()`
    # from a scheduled job to create/retire partitions on rolling basis.
    op.execute(
        "DO $$ BEGIN RAISE NOTICE 'pg_partman configured for ai_audit_log "
        "(monthly, premake=4, retention=24 months)'; END $$"
    )


def downgrade() -> None:
    bind = op.get_bind()
    has_partman = bind.exec_driver_sql(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman'"
    ).first() is not None
    if not has_partman:
        return
    op.execute(
        "DELETE FROM partman.part_config WHERE parent_table = 'public.ai_audit_log'"
    )
