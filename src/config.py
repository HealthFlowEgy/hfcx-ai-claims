"""
hfcx-ai-claims — Central Configuration
Loaded once at startup; injected via FastAPI dependency injection.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, RedisDsn, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── App ──────────────────────────────────────────────────────────────
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "hfcx-ai-claims"
    app_version: str = "1.0.0"
    log_level: str = "INFO"
    secret_key: str = Field(min_length=32)

    # ── API Server ───────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8090
    workers: int = 4

    # ── PostgreSQL ───────────────────────────────────────────────────────
    database_url: PostgresDsn
    database_pool_size: int = 20
    database_max_overflow: int = 10

    # ── Redis ────────────────────────────────────────────────────────────
    redis_url: RedisDsn
    redis_eligibility_ttl_seconds: int = 3600
    redis_agent_state_ttl_seconds: int = 86400

    # ── Kafka ────────────────────────────────────────────────────────────
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "hfcx-ai-claims-group"
    kafka_topic_claims_validated: str = "hcx.claims.validated"
    kafka_topic_claims_enriched: str = "hcx.claims.enriched"
    kafka_topic_dlq: str = "hcx.claims.ai.dlq"
    kafka_max_poll_records: int = 100
    kafka_session_timeout_ms: int = 30000

    # ── LiteLLM Gateway ──────────────────────────────────────────────────
    litellm_base_url: AnyHttpUrl = "http://localhost:4000"  # type: ignore[assignment]
    litellm_api_key: str = "sk-internal-hfcx"
    litellm_coordinator_model: str = "ollama/medgemma:27b"
    litellm_coding_model: str = "ollama/llama3:8b-instruct"
    litellm_arabic_model: str = "ollama/bimediX:8x7b"
    litellm_fast_model: str = "ollama/qwen3:7b"
    litellm_timeout_seconds: int = 30
    litellm_max_retries: int = 3

    # ── ChromaDB ─────────────────────────────────────────────────────────
    chroma_host: str = "localhost"
    chroma_port: int = 8000
    chroma_collection_eda_formulary: str = "eda_formulary"
    chroma_collection_clinical_guidelines: str = "clinical_guidelines"

    # ── Keycloak ─────────────────────────────────────────────────────────
    keycloak_url: AnyHttpUrl = "http://localhost:8080"  # type: ignore[assignment]
    keycloak_realm: str = "hcx"
    keycloak_client_id: str = "hfcx-ai-service"
    keycloak_client_secret: str

    # ── HFCX Platform ────────────────────────────────────────────────────
    hfcx_registry_url: AnyHttpUrl = "http://localhost:8081/hcx/v0.8/participant/info"  # type: ignore[assignment]
    hfcx_api_gateway_url: AnyHttpUrl = "http://localhost:8082"  # type: ignore[assignment]

    # ── MinIO ────────────────────────────────────────────────────────────
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket_models: str = "ai-model-weights"
    minio_bucket_documents: str = "claim-documents"
    minio_secure: bool = False

    # ── OpenTelemetry ────────────────────────────────────────────────────
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"
    otel_service_name: str = "hfcx-ai-claims"

    # ── Fraud Detection ──────────────────────────────────────────────────
    fraud_isolation_forest_contamination: float = 0.05
    fraud_high_risk_threshold: float = 0.75
    fraud_medium_risk_threshold: float = 0.45
    fraud_network_graph_refresh_hours: int = 6

    # ── Feature Flags ────────────────────────────────────────────────────
    enable_fraud_agent: bool = True
    enable_coding_agent: bool = True
    enable_eligibility_agent: bool = True
    enable_necessity_agent: bool = True
    enable_arabic_nlp: bool = True
    ai_bypass_on_failure: bool = True

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached singleton — safe to call from anywhere."""
    return Settings()  # type: ignore[call-arg]
