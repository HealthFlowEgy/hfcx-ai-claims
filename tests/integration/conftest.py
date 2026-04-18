"""
Shared fixtures for integration tests.

These tests spin up real Postgres, Redis, and Redpanda (Kafka) via
testcontainers. They are OPT-IN — CI runs them under a separate job
with `pytest tests/integration/` and the default `pytest tests/`
command skips them via `--ignore=tests/integration`.

Requirements:
    pip install -e ".[dev]"
    Docker daemon must be reachable (testcontainers spawns real
    containers, not lightweight shims).
"""
from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# Mark the whole integration directory as opt-in.
pytestmark = pytest.mark.integration


def _docker_available() -> bool:
    """Cheap probe — avoid failing with a stack trace if Docker is absent."""
    try:
        import docker  # type: ignore

        client = docker.from_env()
        client.ping()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[object]:
    if not _docker_available():
        if "DATABASE_URL" in os.environ:
            yield None
            return
        pytest.skip("Docker not available and DATABASE_URL not set — integration tests skipped")
    from testcontainers.postgres import PostgresContainer  # type: ignore

    with PostgresContainer("postgres:15-alpine") as pg:
        os.environ["DATABASE_URL"] = pg.get_connection_url().replace(
            "postgresql+psycopg2", "postgresql+asyncpg"
        )
        yield pg


@pytest.fixture(scope="session")
def redis_container() -> Iterator[object]:
    if not _docker_available():
        if "REDIS_URL" in os.environ:
            yield None
            return
        pytest.skip("Docker not available and REDIS_URL not set — integration tests skipped")
    from testcontainers.redis import RedisContainer  # type: ignore

    with RedisContainer("redis:7-alpine") as rc:
        os.environ["REDIS_URL"] = (
            f"redis://{rc.get_container_host_ip()}:{rc.get_exposed_port(6379)}/0"
        )
        yield rc


@pytest.fixture(scope="session")
def kafka_container() -> Iterator[object]:
    if not _docker_available():
        pytest.skip("Docker not available — integration tests skipped")
    try:
        from testcontainers.kafka import KafkaContainer  # type: ignore
    except ImportError:
        pytest.skip("testcontainers-kafka not installed")

    with KafkaContainer() as kc:
        os.environ["KAFKA_BOOTSTRAP_SERVERS"] = kc.get_bootstrap_server()
        yield kc
