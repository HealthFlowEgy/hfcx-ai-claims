"""
Prometheus Metrics (SRS Section 10.3)
All metrics are prefixed with hfcx_ai_ for Grafana dashboard filtering.
"""
from prometheus_client import Counter, Gauge, Histogram

# ── Request metrics ───────────────────────────────────────────────────────────
REQUESTS_TOTAL = Counter(
    "hfcx_ai_requests_total",
    "Total HTTP requests to AI layer",
    ["method", "path", "status"],
)
REQUEST_LATENCY = Histogram(
    "hfcx_ai_request_latency_seconds",
    "HTTP request latency",
    ["method", "path"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
)

# ── Claim processing metrics ──────────────────────────────────────────────────
CLAIMS_PROCESSED = Counter(
    "hfcx_ai_claims_processed_total",
    "Total claims processed by AI layer",
)
ADJUDICATION_DECISIONS = Counter(
    "hfcx_ai_adjudication_decisions_total",
    "Adjudication decisions by outcome",
    ["decision"],
)

# ── Agent metrics ─────────────────────────────────────────────────────────────
AGENT_LATENCY = Histogram(
    "hfcx_ai_agent_latency_seconds",
    "Agent processing latency",
    ["agent"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)

# ── Kafka metrics ─────────────────────────────────────────────────────────────
KAFKA_MESSAGES_CONSUMED = Counter(
    "hfcx_ai_kafka_messages_consumed_total",
    "Total Kafka messages consumed from hcx.claims.validated",
)
KAFKA_MESSAGES_PRODUCED = Counter(
    "hfcx_ai_kafka_messages_produced_total",
    "Total Kafka messages published to hcx.claims.enriched",
)
KAFKA_DLQ_MESSAGES = Counter(
    "hfcx_ai_kafka_dlq_messages_total",
    "Total messages sent to Dead Letter Queue",
)
KAFKA_CONSUMER_LAG = Gauge(
    "hfcx_ai_kafka_consumer_lag",
    "Current Kafka consumer lag (hcx.claims.validated)",
)

# ── Fraud metrics ─────────────────────────────────────────────────────────────
FRAUD_SCORE_HISTOGRAM = Histogram(
    "hfcx_ai_fraud_scores",
    "Distribution of fraud scores",
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
)
FRAUD_HIGH_RISK_CLAIMS = Counter(
    "hfcx_ai_fraud_high_risk_total",
    "Total claims flagged as high/critical fraud risk",
)

# ── Model performance metrics ─────────────────────────────────────────────────
MODEL_INFERENCE_LATENCY = Histogram(
    "hfcx_ai_model_inference_latency_seconds",
    "LLM inference latency per model",
    ["model"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
)

# ── Circuit breaker ───────────────────────────────────────────────────────────
CIRCUIT_BREAKER_TRIPS = Counter(
    "hfcx_ai_circuit_breaker_trips_total",
    "Number of times a circuit breaker has tripped to open",
    ["breaker"],
)

# ── Memory (shared pattern store) ─────────────────────────────────────────────
MEMORY_STORE_OPS = Counter(
    "hfcx_ai_memory_store_ops_total",
    "Agent memory store operations",
    ["tier", "outcome"],   # tier=l1|l2; outcome=ok|error
)

# ── Audit log batcher ─────────────────────────────────────────────────────────
AUDIT_QUEUE_DEPTH = Gauge(
    "hfcx_ai_audit_queue_depth",
    "Current depth of the audit log batcher queue",
)
AUDIT_EVENTS_FLUSHED = Counter(
    "hfcx_ai_audit_events_flushed_total",
    "Total audit events written to ai_audit_log by the batcher",
)
AUDIT_EVENTS_DROPPED = Counter(
    "hfcx_ai_audit_events_dropped_total",
    "Audit events dropped because the batcher queue was full",
)

# ── Model drift (SRS 10.3) ────────────────────────────────────────────────────
MODEL_DRIFT_SCORE = Gauge(
    "hfcx_ai_model_drift_score",
    "Rolling drift score for each model (0 = identical, 1 = very different)",
    ["model"],
)
MODEL_ACCURACY = Gauge(
    "hfcx_ai_model_accuracy",
    "Rolling 7-day accuracy estimate per model/label",
    ["model", "label"],
)

# ── Multimodal analysis ───────────────────────────────────────────────────────
MULTIMODAL_DOCUMENTS_PROCESSED = Counter(
    "hfcx_ai_multimodal_documents_processed_total",
    "Total documents analyzed by the multimodal agent",
    ["outcome"],           # ok|error|skipped
)

# ── HAPI FHIR terminology ─────────────────────────────────────────────────────
HAPI_TERMINOLOGY_LOOKUPS = Counter(
    "hfcx_ai_hapi_terminology_lookups_total",
    "ICD-10 / SNOMED lookups against HAPI FHIR terminology",
    ["system", "outcome"],  # system=icd10|snomed; outcome=hit|miss|error
)
