"""
Fraud Detection Agent (SRS 4.4)

Multi-model ensemble fraud scoring:
  1. PyOD ensemble — IForest + LOF + HBOS (FR-FD-004)
  2. XGBoost (supervised) — enabled in Phase 2 after 3 months of labeled data
  3. Rule-based heuristics — fast Egyptian NHIA domain checks
  4. Cross-payer duplicate detection via SHA-256 hash (FR-FD-002)
  5. NetworkX provider-patient-pharmacy graph analysis (FR-FD-003)
  6. MedGemma natural-language fraud explanation (FR-FD-005)

Tools: scikit-learn (BSD-3), XGBoost (Apache 2.0), PyOD (BSD-2), NetworkX (BSD-3)

Model persistence
─────────────────
Detectors are trained on a rolling window of historical features loaded from
Redis and fit lazily on first use. In Phase 2 the fitted model state is
persisted to MinIO (SEC-004) and hydrated at startup — see MODEL_BUCKET.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import networkx as nx
import numpy as np
import structlog
from pyod.models.hbos import HBOS
from pyod.models.iforest import IForest
from pyod.models.lof import LOF

from src.config import get_settings
from src.models.orm import create_engine_and_session
from src.models.schemas import (
    AgentStatus,
    FHIRClaimBundle,
    FraudDetectionResult,
    RiskLevel,
)
from src.services.audit_service import AuditService
from src.services.llm_service import LLMService
from src.services.model_store import ModelStoreError, fetch_to_local
from src.services.redis_service import RedisService, _await_redis
from src.utils.metrics import AGENT_LATENCY

log = structlog.get_logger(__name__)
settings = get_settings()

FEATURE_NAMES = (
    "total_amount",
    "diagnosis_count",
    "procedure_count",
    "drug_count",
    "attachment_count",
    "has_clinical_notes",
    "has_prescription",
    "claim_lag_days",
    "days_since_claim",
    "service_weekday",
    "is_weekend",
    "hour_of_service",
    "amount_per_diagnosis",
    "amount_per_procedure",
    "claim_type_code",
    "provider_hash_bucket",
)


class FraudDetectionAgent:
    """
    FR-FD-001 through FR-FD-005.

    Scoring pipeline:
      Phase 1 (current): PyOD ensemble + rule heuristics + cross-payer dedup
                         + NetworkX ring detection + MedGemma explanation.
      Phase 2 (after 3 months of labeled data): +XGBoost supervised classifier.
    """

    # Process-wide fitted-model state (singletons).
    _FITTED: bool = False
    _IFOREST: IForest | None = None
    _LOF: LOF | None = None
    _HBOS: HBOS | None = None
    # Lazy-init lock — concurrent first-call coroutines would otherwise both
    # race into _ensure_fitted() and fit the detectors twice.
    _FIT_LOCK: asyncio.Lock | None = None

    # XGBoost supervised model (Phase 2). Hydrated lazily from MinIO via
    # services.model_store; stays None until a model URI is configured.
    _XGB_MODEL: Any | None = None
    _XGB_LOADED: bool = False
    _XGB_LOCK: asyncio.Lock | None = None

    def __init__(self) -> None:
        self._redis = RedisService()
        self._llm = LLMService()

    @classmethod
    def _get_fit_lock(cls) -> asyncio.Lock:
        if cls._FIT_LOCK is None:
            cls._FIT_LOCK = asyncio.Lock()
        return cls._FIT_LOCK

    @classmethod
    def _get_xgb_lock(cls) -> asyncio.Lock:
        if cls._XGB_LOCK is None:
            cls._XGB_LOCK = asyncio.Lock()
        return cls._XGB_LOCK

    # ── Public entry point ────────────────────────────────────────────────
    async def score(self, claim: FHIRClaimBundle) -> FraudDetectionResult:
        with AGENT_LATENCY.labels(agent="fraud_detection").time():
            return await self._run_scoring(claim)

    async def _run_scoring(self, claim: FHIRClaimBundle) -> FraudDetectionResult:
        try:
            features = self._engineer_features(claim)

            rule_flags = await self._apply_rule_engine(claim)
            dedup_flag = await self._cross_payer_duplicate_check(claim)
            if dedup_flag:
                rule_flags.append(dedup_flag)

            ensemble_score, per_detector = await self._pyod_ensemble(features)
            network_score, net_indicators = await self._network_analysis(
                provider_id=claim.provider_id,
                patient_id=claim.patient_id,
                drug_codes=claim.drug_codes,
            )

            # FR-FD-001 Phase 2: XGBoost supervised classifier. Enabled only
            # once a trained model artifact exists (configured via
            # XGBOOST_MODEL_URI). Until then this returns None and the
            # rule + unsupervised ensemble carries the load.
            xgb_score = await self._xgboost_score(features)
            if xgb_score is not None:
                per_detector["xgboost"] = xgb_score

            # Weighted ensemble. When XGBoost is available we blend it in
            # at `settings.xgboost_blend_weight` and proportionally reduce
            # the PyOD ensemble weight so the total always sums to 1.
            rule_score = min(len(rule_flags) * 0.15, 0.9)
            if xgb_score is not None:
                w_xgb = settings.xgboost_blend_weight
                w_ens = 0.50 * (1 - w_xgb / 0.70)  # keep rule=0.30, net=0.20
                w_ens = max(w_ens, 0.10)
                w_rule = 0.30
                w_net = 0.20
                final_score = (
                    rule_score * w_rule
                    + ensemble_score * w_ens
                    + xgb_score * w_xgb
                    + network_score * w_net
                )
            else:
                final_score = (
                    (rule_score * 0.30)
                    + (ensemble_score * 0.50)
                    + (network_score * 0.20)
                )
            final_score = round(min(final_score, 1.0), 4)

            risk_level = self._classify_risk(final_score)
            refer_to_siu = (
                risk_level in (RiskLevel.CRITICAL, RiskLevel.HIGH)
                or len(net_indicators) >= 2
            )

            await self._update_provider_score(claim.provider_id, final_score)

            # FR-FD-005: MedGemma-generated explanation (only when risk is non-low)
            explanation: str | None = None
            if risk_level != RiskLevel.LOW:
                explanation = await self._explain_fraud(
                    claim=claim,
                    score=final_score,
                    rule_flags=rule_flags,
                    network_indicators=net_indicators,
                )

            log.info(
                "fraud_score_complete",
                claim_id=claim.claim_id,
                score=final_score,
                risk=risk_level,
                rule_flags=len(rule_flags),
                ensemble=ensemble_score,
                network_score=network_score,
            )

            await AuditService.record(
                event_type="ai.scored",
                correlation_id=claim.hcx_correlation_id,
                claim_id=claim.claim_id,
                agent_name="fraud_detection",
                action="score",
                outcome="ok",
                fraud_risk_level=risk_level.value,
                detail={
                    "rule_flags": rule_flags,
                    "ensemble_detectors": per_detector,
                    "network_score": network_score,
                },
            )

            return FraudDetectionResult(
                status=AgentStatus.COMPLETED,
                fraud_score=final_score,
                risk_level=risk_level,
                anomaly_flags=[{"detector": k, "score": v} for k, v in per_detector.items()],
                network_risk_indicators=net_indicators,
                billing_pattern_flags=rule_flags,
                isolation_forest_score=per_detector.get("iforest"),
                xgboost_score=None,
                pyod_ensemble_score=ensemble_score,
                refer_to_siu=refer_to_siu,
                explanation=explanation,
            )

        except Exception as exc:
            log.error("fraud_scoring_failed", error=str(exc), claim_id=claim.claim_id)
            return FraudDetectionResult(
                status=AgentStatus.FAILED,
                fraud_score=None,
                error_message=str(exc),
            )

    # ── Feature engineering (FR-FD-004: 15+ features) ─────────────────────
    def _engineer_features(self, claim: FHIRClaimBundle) -> np.ndarray:
        now = datetime.now(UTC)
        claim_date = _ensure_aware(claim.claim_date)
        service_date = _ensure_aware(claim.service_date)

        diag = len(claim.diagnosis_codes)
        proc = len(claim.procedure_codes)
        drug = len(claim.drug_codes)
        attach = len(claim.attachment_ids)

        features = [
            float(claim.total_amount),                                        # 1  total_amount
            float(diag),                                                      # 2  diagnosis_count
            float(proc),                                                      # 3  procedure_count
            float(drug),                                                      # 4  drug_count
            float(attach),                                                    # 5  attachment_count
            1.0 if claim.clinical_notes else 0.0,               # 6  has_clinical_notes
            1.0 if claim.prescription_id else 0.0,              # 7  has_prescription
            float((claim_date - service_date).days),                          # 8  claim_lag_days
            float((now - claim_date).days),                                   # 9  days_since_claim
            float(service_date.weekday()),                                    # 10 service_weekday
            1.0 if service_date.weekday() >= 5 else 0.0,                      # 11 is_weekend
            float(service_date.hour),                                         # 12 hour_of_service
            claim.total_amount / max(diag, 1),                    # 13 amt_per_diag
            claim.total_amount / max(proc, 1),                    # 14 amt_per_proc
            float(hash(claim.claim_type.value) % 10),             # 15 claim_type
            float(
                int(hashlib.md5(claim.provider_id.encode()).hexdigest()[:4], 16) % 64
            ),                                                    # 16 provider_hash
        ]
        arr = np.array(features, dtype=np.float32)
        assert arr.shape[0] >= 15, "FR-FD-004 requires at least 15 features"
        return arr.reshape(1, -1)

    # ── Rule engine ───────────────────────────────────────────────────────
    async def _apply_rule_engine(self, claim: FHIRClaimBundle) -> list[str]:
        flags: list[str] = []

        if claim.claim_type.value == "outpatient" and claim.total_amount > 50_000:
            flags.append(
                f"Outpatient claim amount unusually high: EGP {claim.total_amount:,.0f}"
            )
        if claim.claim_type.value == "pharmacy" and claim.total_amount > 20_000:
            flags.append(
                f"Pharmacy claim amount unusually high: EGP {claim.total_amount:,.0f}"
            )
        if len(claim.diagnosis_codes) > 10:
            flags.append(
                f"Excessive diagnosis codes: {len(claim.diagnosis_codes)} codes"
            )

        lag_days = (
            _ensure_aware(claim.claim_date) - _ensure_aware(claim.service_date)
        ).days
        if lag_days > 90:
            flags.append(f"Late claim submission: {lag_days} days after service")

        if (
            claim.total_amount > 10_000
            and not claim.attachment_ids
            and not claim.clinical_notes
        ):
            flags.append("High-value claim missing supporting documentation")

        if _ensure_aware(claim.service_date).weekday() >= 5:
            emergency_codes = {"Z99", "A00", "S00", "T00"}
            has_emergency = any(
                code[:3] in emergency_codes for code in claim.diagnosis_codes
            )
            if claim.claim_type.value == "inpatient" and not has_emergency:
                flags.append(
                    "Inpatient admission on weekend without emergency diagnosis"
                )
        return flags

    # ── FR-FD-002: cross-payer duplicate detection ───────────────────────
    async def _cross_payer_duplicate_check(
        self, claim: FHIRClaimBundle
    ) -> str | None:
        """
        SRS: SHA-256(patient_nid + service_date + procedure_code) — checked
        across all claims (all payers) within a 30-day window.

        Primary store: PostgreSQL ai_claim_duplicate with partial index.
        Redis is used as an opportunistic bloom filter — if the table write
        fails we still have the in-memory short-circuit.
        """
        window_days = settings.fraud_duplicate_window_days
        since = datetime.now(UTC) - timedelta(days=window_days)

        # Compose SHA-256 hash keyed by patient + service_date + every procedure_code.
        # One procedure_code → one hash row. For multi-line claims we write multiple.
        procedure_codes = claim.procedure_codes or [""]
        hashes: list[str] = []
        for proc in procedure_codes:
            svc_date = _ensure_aware(claim.service_date).date().isoformat()
            raw = f"{claim.patient_id}|{svc_date}|{proc}"
            hashes.append(hashlib.sha256(raw.encode()).hexdigest())

        try:
            _, session_factory = create_engine_and_session()
            from sqlalchemy import text

            async with session_factory() as session:
                # Lookup: any existing row in the window?
                stmt = text(
                    """
                    SELECT claim_correlation_id, payer_id
                    FROM ai_claim_duplicate
                    WHERE dup_hash = ANY(:hashes) AND observed_at >= :since
                    LIMIT 1
                    """
                )
                row = (
                    await session.execute(
                        stmt, {"hashes": hashes, "since": since}
                    )
                ).first()

                # Upsert our observations
                insert_stmt = text(
                    """
                    INSERT INTO ai_claim_duplicate
                        (dup_hash, claim_correlation_id, provider_id, payer_id)
                    SELECT unnest(:hashes), :corr, :prov, :payer
                    """
                )
                await session.execute(
                    insert_stmt,
                    {
                        "hashes": hashes,
                        "corr": claim.hcx_correlation_id or claim.claim_id,
                        "prov": claim.provider_id,
                        "payer": claim.payer_id,
                    },
                )
                await session.commit()

                if row and row[0] != (claim.hcx_correlation_id or claim.claim_id):
                    return (
                        f"Potential duplicate claim across payers "
                        f"(previous correlation_id={row[0]})"
                    )
                return None
        except Exception as exc:
            log.warning("dedup_db_failed_fallback_redis", error=str(exc))

        # Redis fallback
        marker = f"fraud:dup:{hashes[0]}"
        existing = await self._redis.get(marker)
        if existing and existing != (claim.hcx_correlation_id or claim.claim_id):
            return "Potential duplicate claim (Redis fallback)"
        await self._redis.setex(
            marker,
            86400 * window_days,
            claim.hcx_correlation_id or claim.claim_id,
        )
        return None

    # ── FR-FD-004: PyOD ensemble over the feature vector ─────────────────
    async def _pyod_ensemble(
        self, features: np.ndarray
    ) -> tuple[float, dict[str, float]]:
        """
        Run the three PyOD detectors and return a weighted ensemble score in [0, 1].
        If the models haven't been fitted yet, we fit them on a baseline drawn from
        Redis (or a synthetic seed for cold-start).
        """
        await self._ensure_fitted()
        x = features

        try:
            iforest_raw = float(
                FraudDetectionAgent._IFOREST.decision_function(x)[0]  # noqa
            )
            iforest_score = float(
                FraudDetectionAgent._IFOREST.predict_proba(x)[:, 1][0]  # noqa
            )
        except Exception:
            iforest_score = 0.0
            iforest_raw = 0.0

        try:
            lof_score = float(
                FraudDetectionAgent._LOF.decision_function(x)[0]  # noqa
            )
        except Exception:
            lof_score = 0.0

        try:
            hbos_score = float(
                FraudDetectionAgent._HBOS.decision_function(x)[0]  # noqa
            )
        except Exception:
            hbos_score = 0.0

        # Normalize raw scores to [0, 1] with a soft squash
        def _squash(v: float) -> float:
            return float(np.clip(1.0 / (1.0 + np.exp(-v)), 0.0, 1.0))

        per = {
            "iforest": round(iforest_score, 4),
            "iforest_raw": round(_squash(iforest_raw), 4),
            "lof": round(_squash(lof_score), 4),
            "hbos": round(_squash(hbos_score), 4),
        }
        # Simple average of the three probability-scale signals
        ensemble = (per["iforest"] + per["lof"] + per["hbos"]) / 3.0
        return round(float(ensemble), 4), per

    async def _ensure_fitted(self) -> None:
        # Fast path: already fitted, no lock needed
        if FraudDetectionAgent._FITTED:
            return

        # Slow path: serialize through the class-level lock so two cold-start
        # coroutines cannot both fit the detectors in parallel.
        async with self._get_fit_lock():
            # Double-checked locking: another coroutine may have raced us.
            if FraudDetectionAgent._FITTED:
                return

            # Seed baseline from Redis — keyed list of recent feature vectors.
            baseline: list[list[float]] = []
            try:
                raw_list = await _await_redis(self._redis.client.lrange(
                    "fraud:baseline:features", 0, 999
                ))
                for item in raw_list:
                    try:
                        baseline.append(json.loads(item))
                    except Exception:
                        continue
            except Exception as exc:
                log.debug("fraud_baseline_unavailable", error=str(exc))

            # Cold start: generate a small synthetic baseline so PyOD can fit.
            if len(baseline) < 50:
                rng = np.random.default_rng(42)
                synthetic = rng.normal(
                    loc=[
                        3000, 2, 1, 1, 1, 1, 0, 3, 30, 2, 0, 10, 1500, 3000, 0, 16,
                    ],
                    scale=[
                        1500, 1, 1, 1, 1, 0.3, 0.3, 2, 20, 1, 0.3, 4, 1000, 2000, 2, 16,
                    ],
                    size=(200, 16),
                ).astype(np.float32)
                data = synthetic
            else:
                data = np.array(baseline, dtype=np.float32)

            contamination = settings.fraud_isolation_forest_contamination
            FraudDetectionAgent._IFOREST = IForest(
                contamination=contamination, random_state=42, n_estimators=100
            )
            FraudDetectionAgent._LOF = LOF(
                contamination=contamination, n_neighbors=20
            )
            FraudDetectionAgent._HBOS = HBOS(contamination=contamination)
            try:
                FraudDetectionAgent._IFOREST.fit(data)
                FraudDetectionAgent._LOF.fit(data)
                FraudDetectionAgent._HBOS.fit(data)
                FraudDetectionAgent._FITTED = True
                log.info("fraud_ensemble_fitted", samples=int(data.shape[0]))
            except Exception as exc:  # pragma: no cover
                log.warning("fraud_fit_failed", error=str(exc))

    # ── FR-FD-001 Phase 2: XGBoost supervised classifier ────────────────
    async def _xgboost_score(self, features: np.ndarray) -> float | None:
        """
        Score the claim with the supervised XGBoost fraud classifier.
        Returns None when XGBoost is not enabled or no model is loaded —
        in that case the unsupervised ensemble carries the full load.

        Model loading is lazy + one-shot: fetched from MinIO via
        services.model_store on first score, then cached on the class.
        """
        if not settings.xgboost_enabled:
            return None
        if not settings.xgboost_model_uri:
            return None

        await self._load_xgboost()
        model = FraudDetectionAgent._XGB_MODEL
        if model is None:
            return None

        try:
            # xgboost.Booster takes a DMatrix; sklearn-style XGBClassifier
            # takes a plain ndarray. Support both to keep the artifact
            # format flexible for the training team.
            import xgboost as xgb

            if hasattr(model, "predict_proba"):
                proba = model.predict_proba(features)[:, 1][0]
            else:
                dm = xgb.DMatrix(features)
                proba = float(model.predict(dm)[0])
            return float(max(0.0, min(1.0, proba)))
        except Exception as exc:
            log.warning("xgboost_predict_failed", error=str(exc))
            return None

    async def _load_xgboost(self) -> None:
        if FraudDetectionAgent._XGB_LOADED:
            return

        async with self._get_xgb_lock():
            if FraudDetectionAgent._XGB_LOADED:
                return
            FraudDetectionAgent._XGB_LOADED = True  # set early to avoid retry storms

            try:
                local = fetch_to_local(settings.xgboost_model_uri)
            except ModelStoreError as exc:
                log.warning(
                    "xgboost_fetch_failed",
                    uri=settings.xgboost_model_uri,
                    error=str(exc),
                )
                return

            try:
                import xgboost as xgb

                booster = xgb.Booster()
                booster.load_model(str(local))
                FraudDetectionAgent._XGB_MODEL = booster
                log.info(
                    "xgboost_model_loaded",
                    uri=settings.xgboost_model_uri,
                    local=str(local),
                )
            except Exception as exc:  # pragma: no cover
                log.warning("xgboost_load_failed", error=str(exc))

    # ── FR-FD-003: NetworkX provider-patient-pharmacy graph ──────────────
    _API_PLACEHOLDERS = {"api-check", "synthetic-test", "api-caller"}

    async def _network_analysis(
        self,
        provider_id: str,
        patient_id: str,
        drug_codes: list[str],
    ) -> tuple[float, list[str]]:
        """
        Build a localized graph from recent edges stored in Redis and run
        simple structural checks (degree, triangle count) to flag rings.

        Redis stores adjacency edges under: fraud:edges:provider_patient,
        fraud:edges:patient_pharmacy. Each is a set of "src|dst" strings.
        """
        indicators: list[str] = []
        g = nx.Graph()

        # Direct /internal/ai/agents/* test calls use placeholder IDs. Skip
        # graph mutation in that path so we never pollute production edges.
        is_placeholder = (
            provider_id in self._API_PLACEHOLDERS
            or patient_id in self._API_PLACEHOLDERS
        )

        # Seed graph with recent edges (bounded)
        try:
            pp_edges = await _await_redis(self._redis.client.smembers(
                "fraud:edges:provider_patient"
            ))
            for e in list(pp_edges)[:500]:
                a, b = e.split("|", 1)
                g.add_edge(f"prov:{a}", f"pat:{b}")

            for code in drug_codes[:10]:
                pharm_edges = await _await_redis(self._redis.client.smembers(
                    f"fraud:edges:patient_pharmacy:{code}"
                ))
                for e in list(pharm_edges)[:200]:
                    a, b = e.split("|", 1)
                    g.add_edge(f"pat:{a}", f"pharm:{b}")
        except Exception as exc:
            log.debug("fraud_graph_load_failed", error=str(exc))

        g.add_edge(f"prov:{provider_id}", f"pat:{patient_id}")
        for code in drug_codes:
            g.add_edge(f"pat:{patient_id}", f"pharm:{code}")

        # Persist the new edge (bounded write) — skipped for placeholder IDs
        # so direct /internal/ai/agents/* calls never pollute production edges.
        if not is_placeholder:
            try:
                await _await_redis(self._redis.client.sadd(
                    "fraud:edges:provider_patient",
                    f"{provider_id}|{patient_id}",
                ))
                await _await_redis(self._redis.client.expire(
                    "fraud:edges:provider_patient", 86400 * 30
                ))
                for code in drug_codes:
                    key = f"fraud:edges:patient_pharmacy:{code}"
                    await _await_redis(
                        self._redis.client.sadd(key, f"{patient_id}|{code}")
                    )
                    await _await_redis(self._redis.client.expire(key, 86400 * 30))
            except Exception:
                pass

        network_score = 0.0

        # Structural signals
        try:
            provider_node = f"prov:{provider_id}"
            if provider_node in g:
                degree = g.degree(provider_node)
                if degree > 50:
                    indicators.append(
                        f"Provider has unusually high patient fan-out (degree={degree})"
                    )
                    network_score = max(network_score, 0.6)
                elif degree > 20:
                    network_score = max(network_score, 0.3)

            patient_node = f"pat:{patient_id}"
            if patient_node in g and g.degree(patient_node) > 10:
                indicators.append(
                    "Patient connected to unusually many providers/pharmacies"
                )
                network_score = max(network_score, 0.5)

            # Triangle count around the provider as a ring proxy
            triangles = 0
            if provider_node in g:
                triangles = sum(
                    1 for _ in nx.triangles(g, nodes=[provider_node]).values()
                )
            if triangles > 3:
                indicators.append(
                    f"Provider embedded in {triangles} closed triangles — possible ring"
                )
                network_score = max(network_score, 0.7)
        except Exception as exc:  # pragma: no cover
            log.debug("fraud_graph_analysis_failed", error=str(exc))

        # Rolling provider score
        try:
            raw = await self._redis.get(f"fraud:provider_score:{provider_id}")
            if raw:
                data = json.loads(raw)
                rolling = data.get("rolling_fraud_score", 0.0)
                claim_count = data.get("claim_count", 0)
                if rolling > settings.fraud_high_risk_threshold:
                    indicators.append(
                        f"Provider {provider_id} has high historical fraud score: {rolling:.2f}"
                    )
                    network_score = max(network_score, 0.8)
                elif rolling > settings.fraud_medium_risk_threshold:
                    indicators.append(
                        f"Provider {provider_id} has elevated fraud history: {rolling:.2f}"
                    )
                    network_score = max(network_score, 0.4)
                if claim_count > 500 and rolling > 0.3:
                    indicators.append("High-volume provider with elevated fraud rate")
        except Exception:
            pass

        return round(network_score, 4), indicators

    async def _update_provider_score(
        self, provider_id: str, claim_score: float
    ) -> None:
        key = f"fraud:provider_score:{provider_id}"
        raw = await self._redis.get(key)
        if raw:
            data = json.loads(raw)
        else:
            data = {"rolling_fraud_score": 0.0, "claim_count": 0, "score_sum": 0.0}

        data["claim_count"] += 1
        data["score_sum"] += claim_score
        data["rolling_fraud_score"] = data["score_sum"] / data["claim_count"]
        data["last_updated"] = datetime.now(UTC).isoformat()
        await self._redis.setex(key, 86400 * 90, json.dumps(data))

    # ── FR-FD-005: MedGemma fraud explanation ─────────────────────────────
    async def _explain_fraud(
        self,
        *,
        claim: FHIRClaimBundle,
        score: float,
        rule_flags: list[str],
        network_indicators: list[str],
    ) -> str | None:
        prompt = (
            "You are a senior fraud analyst for Egypt's NHIA. In 2-3 short "
            "sentences, explain the fraud risk for this claim. Cite the specific "
            "signals only — do NOT mention patient identity.\n\n"
            f"Fraud score: {score:.2f}\n"
            f"Claim type: {claim.claim_type.value}\n"
            f"Total amount (EGP): {claim.total_amount:,.2f}\n"
            f"Rule flags: {rule_flags}\n"
            f"Network indicators: {network_indicators}\n"
        )
        try:
            return await self._llm.complete(
                prompt=prompt, max_tokens=180, temperature=0.2
            )
        except Exception as exc:
            log.warning("fraud_explain_failed", error=str(exc))
            return None

    # ── Risk bucketing ────────────────────────────────────────────────────
    def _classify_risk(self, score: float) -> RiskLevel:
        if score >= 0.90:
            return RiskLevel.CRITICAL
        elif score >= settings.fraud_high_risk_threshold:
            return RiskLevel.HIGH
        elif score >= settings.fraud_medium_risk_threshold:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt
