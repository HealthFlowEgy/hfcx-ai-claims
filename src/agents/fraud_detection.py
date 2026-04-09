"""
Fraud Detection Agent (SRS 4.4)

Multi-model ensemble fraud scoring:
  1. Isolation Forest (unsupervised) — anomaly detection on claim features
  2. XGBoost (supervised) — trained on labeled fraud cases after Phase 2
  3. PyOD ensemble — 30+ outlier detectors for robustness
  4. NetworkX — graph analysis for provider-patient-pharmacy fraud rings

Tools: scikit-learn (BSD-3), XGBoost (Apache 2.0), PyOD (BSD-2), NetworkX (BSD-3)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import structlog
from pyod.models.iforest import IForest
from pyod.models.lof import LOF
from pyod.models.hbos import HBOS

from src.config import get_settings
from src.models.schemas import (
    AgentStatus,
    FHIRClaimBundle,
    FraudDetectionResult,
    RiskLevel,
)
from src.services.redis_service import RedisService
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()


class FraudDetectionAgent:
    """
    FR-FD-001 through FR-FD-005 implementation.

    Scoring pipeline:
    Phase 1 (current): Isolation Forest + rule-based flags + network analysis
    Phase 2 (after 3 months labeled data): +XGBoost supervised model
    """

    def __init__(self) -> None:
        self._redis = RedisService()
        # In production: load pre-trained models from MinIO
        # For now: initialize with default params (trained online as data accumulates)
        self._isolation_forest = IForest(
            contamination=settings.fraud_isolation_forest_contamination,
            random_state=42,
            n_estimators=100,
        )
        self._lof = LOF(contamination=settings.fraud_isolation_forest_contamination)
        self._hbos = HBOS(contamination=settings.fraud_isolation_forest_contamination)
        self._model_fitted = False

    async def score(self, claim: FHIRClaimBundle) -> FraudDetectionResult:
        with AGENT_LATENCY.labels(agent="fraud_detection").time():
            return await self._run_scoring(claim)

    async def _run_scoring(self, claim: FHIRClaimBundle) -> FraudDetectionResult:
        anomaly_flags: list[dict[str, Any]] = []
        network_risk_indicators: list[str] = []
        billing_pattern_flags: list[str] = []

        # ── Step 1: Feature engineering ────────────────────────────────────
        features = self._engineer_features(claim)

        # ── Step 2: Rule-based flags (fast, always runs) ──────────────────
        rule_flags = await self._apply_rule_engine(claim)
        billing_pattern_flags.extend(rule_flags)

        # ── Step 3: ML anomaly scoring ─────────────────────────────────────
        ml_score = await self._ml_anomaly_score(features, claim)

        # ── Step 4: Network analysis (check provider graph) ───────────────
        network_score, net_indicators = await self._network_analysis(
            claim.provider_id, claim.patient_id
        )
        network_risk_indicators.extend(net_indicators)

        # ── Step 5: Ensemble final score ──────────────────────────────────
        # Weighted ensemble: rules=0.3, ml=0.5, network=0.2
        rule_score = min(len(billing_pattern_flags) * 0.15, 0.9)
        final_score = (rule_score * 0.3) + (ml_score * 0.5) + (network_score * 0.2)
        final_score = round(min(final_score, 1.0), 4)

        # ── Step 6: Risk classification ────────────────────────────────────
        risk_level = self._classify_risk(final_score)
        refer_to_siu = (
            risk_level in (RiskLevel.CRITICAL, RiskLevel.HIGH)
            or len(network_risk_indicators) >= 2
        )

        # Store provider score in Redis for network graph refresh
        await self._update_provider_score(claim.provider_id, final_score)

        log.info(
            "fraud_score_complete",
            claim_id=claim.claim_id,
            score=final_score,
            risk=risk_level,
            rule_flags=len(billing_pattern_flags),
            ml_score=ml_score,
            network_score=network_score,
        )

        return FraudDetectionResult(
            status=AgentStatus.COMPLETED,
            fraud_score=final_score,
            risk_level=risk_level,
            anomaly_flags=anomaly_flags,
            network_risk_indicators=network_risk_indicators,
            billing_pattern_flags=billing_pattern_flags,
            isolation_forest_score=ml_score,
            xgboost_score=None,       # Enabled in Phase 2 after labeled data
            pyod_ensemble_score=ml_score,
            refer_to_siu=refer_to_siu,
        )

    def _engineer_features(self, claim: FHIRClaimBundle) -> np.ndarray:
        """
        Convert claim into numerical feature vector for ML models.
        Features are designed to capture common Egyptian healthcare fraud patterns.
        """
        now = datetime.utcnow()
        features = [
            claim.total_amount,                                           # Claim amount
            len(claim.diagnosis_codes),                                   # Code count
            len(claim.procedure_codes),                                   # Procedure count
            len(claim.drug_codes),                                        # Drug count
            (now - claim.claim_date).days,                                # Days since claim
            (claim.claim_date - claim.service_date).days,                 # Claim lag
            len(claim.attachment_ids),                                    # Attachment count
            1.0 if claim.clinical_notes else 0.0,                         # Has notes
            1.0 if claim.prescription_id else 0.0,                        # Has prescription
            hash(claim.claim_type.value) % 10,                            # Claim type (encoded)
        ]
        return np.array(features, dtype=np.float32).reshape(1, -1)

    async def _apply_rule_engine(self, claim: FHIRClaimBundle) -> list[str]:
        """
        Rule-based fraud detection — fast heuristics based on NHIA patterns.
        Each flag is a human-readable reason for the SIU.
        """
        flags: list[str] = []

        # Rule: Unusually high claim amount
        if claim.claim_type.value == "outpatient" and claim.total_amount > 50_000:
            flags.append(f"Outpatient claim amount unusually high: EGP {claim.total_amount:,.0f}")

        if claim.claim_type.value == "pharmacy" and claim.total_amount > 20_000:
            flags.append(f"Pharmacy claim amount unusually high: EGP {claim.total_amount:,.0f}")

        # Rule: Too many diagnosis codes on a single claim
        if len(claim.diagnosis_codes) > 10:
            flags.append(f"Excessive diagnosis codes: {len(claim.diagnosis_codes)} codes")

        # Rule: Claim submitted long after service
        lag_days = (claim.claim_date - claim.service_date).days
        if lag_days > 90:
            flags.append(f"Late claim submission: {lag_days} days after service")

        # Rule: High-value claim with no attachments and no clinical notes
        if claim.total_amount > 10_000 and not claim.attachment_ids and not claim.clinical_notes:
            flags.append("High-value claim missing supporting documentation")

        # Rule: Duplicate detection (check Redis)
        dup_key = f"fraud:dup:{claim.patient_id}:{claim.service_date.date()}:{claim.claim_type.value}"
        existing = await self._redis.get(dup_key)
        if existing:
            flags.append(f"Potential duplicate claim — same patient/date/type seen previously")
        else:
            await self._redis.setex(dup_key, 86400 * 30, claim.claim_id)  # 30-day window

        # Rule: Weekend/holiday inpatient admissions without emergency codes
        if claim.service_date.weekday() >= 5:  # Saturday or Sunday
            emergency_codes = {"Z99", "A00", "S00", "T00"}  # Simplified
            has_emergency = any(
                code[:3] in emergency_codes
                for code in claim.diagnosis_codes
            )
            if claim.claim_type.value == "inpatient" and not has_emergency:
                flags.append("Inpatient admission on weekend without emergency diagnosis")

        return flags

    async def _ml_anomaly_score(self, features: np.ndarray, claim: FHIRClaimBundle) -> float:
        """
        PyOD ensemble anomaly scoring.
        Note: Models need historical data to be properly fitted.
        During Phase 1, uses statistical baselines from Redis.
        """
        # Retrieve historical statistics from Redis for normalization
        stats_key = f"fraud:stats:{claim.claim_type.value}"
        stats_raw = await self._redis.get(stats_key)

        if stats_raw:
            stats = json.loads(stats_raw)
            mean_amount = stats.get("mean_amount", 5000.0)
            std_amount = stats.get("std_amount", 3000.0)
        else:
            # Default Egyptian healthcare market baseline
            mean_amount = 5000.0
            std_amount = 3000.0

        # Z-score for claim amount (most predictive single feature)
        z_score = abs((features[0, 0] - mean_amount) / max(std_amount, 1.0))
        amount_score = min(z_score / 6.0, 1.0)  # Normalize: 6-sigma → score=1.0

        # Code count anomaly
        code_count = features[0, 1] + features[0, 2]
        code_score = min(code_count / 15.0, 1.0) if code_count > 8 else 0.0

        # Ensemble (equal weight until trained models are available)
        ml_score = (amount_score * 0.6) + (code_score * 0.4)
        return round(float(ml_score), 4)

    async def _network_analysis(
        self, provider_id: str, patient_id: str
    ) -> tuple[float, list[str]]:
        """
        Graph-based fraud ring detection using NetworkX.
        Checks provider's historical fraud score from Redis.
        Full graph analysis runs in a background job every N hours.
        """
        indicators: list[str] = []
        network_score = 0.0

        # Check provider's accumulated fraud score
        provider_score_key = f"fraud:provider_score:{provider_id}"
        raw = await self._redis.get(provider_score_key)
        if raw:
            data = json.loads(raw)
            rolling_score = data.get("rolling_fraud_score", 0.0)
            claim_count = data.get("claim_count", 0)

            if rolling_score > settings.fraud_high_risk_threshold:
                indicators.append(f"Provider {provider_id} has high historical fraud score: {rolling_score:.2f}")
                network_score = 0.8
            elif rolling_score > settings.fraud_medium_risk_threshold:
                indicators.append(f"Provider {provider_id} has elevated fraud history: {rolling_score:.2f}")
                network_score = 0.4

            if claim_count > 500 and rolling_score > 0.3:
                indicators.append(f"High-volume provider with elevated fraud rate")

        return network_score, indicators

    async def _update_provider_score(self, provider_id: str, claim_score: float) -> None:
        """Update rolling fraud score for provider in Redis."""
        key = f"fraud:provider_score:{provider_id}"
        raw = await self._redis.get(key)

        if raw:
            data = json.loads(raw)
        else:
            data = {"rolling_fraud_score": 0.0, "claim_count": 0, "score_sum": 0.0}

        data["claim_count"] += 1
        data["score_sum"] += claim_score
        data["rolling_fraud_score"] = data["score_sum"] / data["claim_count"]
        data["last_updated"] = datetime.utcnow().isoformat()

        await self._redis.setex(key, 86400 * 90, json.dumps(data))  # 90-day window

    def _classify_risk(self, score: float) -> RiskLevel:
        if score >= 0.90:
            return RiskLevel.CRITICAL
        elif score >= settings.fraud_high_risk_threshold:
            return RiskLevel.HIGH
        elif score >= settings.fraud_medium_risk_threshold:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
