"""pg_partman setup for ai_audit_log auto-partitioning

If the pg_partman extension is available this registers the table as a
native-range parent and schedules monthly partition creation so the
audit log never runs out of partitions. If pg_partman is not installed
or cannot be created (e.g., on managed databases like DigitalOcean),
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
    # Use a single PL/pgSQL block that handles all pg_partman setup.
    # If the extension cannot be created (missing schema, not available,
    # insufficient privileges on managed databases), the EXCEPTION handler
    # catches the error and the migration succeeds as a no-op.
    # This keeps the transaction clean for asyncpg.
    op.execute(
        """
        DO $$
        BEGIN
            -- Attempt to create the extension
            CREATE EXTENSION IF NOT EXISTS "pg_partman";

            -- Register ai_audit_log as monthly range-partitioned
            PERFORM partman.create_parent(
                p_parent_table   := 'public.ai_audit_log',
                p_control        := 'created_at',
                p_type           := 'native',
                p_interval       := 'monthly',
                p_premake        := 4,
                p_start_partition := TO_CHAR(
                    DATE_TRUNC('month', NOW()), 'YYYY-MM-DD'
                )
            );

            -- Retention: keep 24 months online; detach (don't drop) older
            UPDATE partman.part_config
               SET retention = '24 months',
                   retention_keep_table = true,
                   retention_keep_index = true,
                   infinite_time_partitions = true
             WHERE parent_table = 'public.ai_audit_log';

            RAISE NOTICE 'pg_partman configured for ai_audit_log '
                         '(monthly, premake=4, retention=24 months)';

        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_partman not available or cannot be created '
                         '(%) — skipping auto-partition setup. '
                         'Partitions can be created manually.',
                         SQLERRM;
        END
        $$
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            DELETE FROM partman.part_config
             WHERE parent_table = 'public.ai_audit_log';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_partman not available — nothing to downgrade';
        END
        $$
        """
    )
