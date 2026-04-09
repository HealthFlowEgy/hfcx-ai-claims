"""
Alembic environment configuration for hfcx-ai-claims.

Uses the async SQLAlchemy engine through a sync facade so alembic's
classic upgrade/downgrade commands work unchanged:

    alembic upgrade head
    alembic downgrade -1
    alembic revision --autogenerate -m "add new column"

Autogenerate reads metadata from src.models.orm.Base.metadata.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from src.config import get_settings
from src.models.orm import Base

# Alembic Config object, providing access to .ini values.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Populate the sqlalchemy.url at runtime from our pydantic-settings.
settings = get_settings()
config.set_main_option("sqlalchemy.url", str(settings.database_url))

# Target metadata for --autogenerate.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL script without a live DB."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode — against the configured async engine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section) or {},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
