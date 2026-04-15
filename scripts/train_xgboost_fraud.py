#!/usr/bin/env python3
"""
Train Initial XGBoost Fraud Classifier — SRS §4.4 FR-FD-001 Phase 2

Generates a synthetic training dataset based on the feature engineering
in src/agents/fraud_detection.py (16 features) and trains an XGBoost
binary classifier for fraud/non-fraud prediction.

The trained model is saved locally and optionally uploaded to MinIO
(S3-compatible) for the fraud detection agent to load at runtime.

Usage:
    python scripts/train_xgboost_fraud.py [--upload]

Feature vector (must match FEATURE_NAMES in fraud_detection.py):
    0  total_amount
    1  diagnosis_count
    2  procedure_count
    3  drug_count
    4  attachment_count
    5  has_clinical_notes
    6  has_prescription
    7  claim_lag_days
    8  days_since_claim
    9  service_weekday
    10 is_weekend
    11 hour_of_service
    12 amount_per_diagnosis
    13 amount_per_procedure
    14 claim_type_code
    15 provider_hash_bucket
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

FEATURE_NAMES = [
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
]

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_PATH = MODEL_DIR / "xgb_fraud_v1.json"
METRICS_PATH = MODEL_DIR / "xgb_fraud_v1_metrics.json"


def generate_synthetic_data(
    n_samples: int = 10000,
    fraud_ratio: float = 0.08,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic claims data with realistic Egyptian healthcare patterns.

    Fraud patterns injected:
    - Unusually high amounts for outpatient/pharmacy
    - Excessive diagnosis codes
    - Late claim submissions (high lag days)
    - Weekend services without emergency codes
    - Missing documentation on high-value claims
    - Concentrated provider hash buckets (collusion rings)
    """
    rng = np.random.default_rng(seed)
    n_fraud = int(n_samples * fraud_ratio)
    n_legit = n_samples - n_fraud

    # ── Legitimate claims ───────────────────────────────────────────────────
    legit = np.column_stack([
        rng.lognormal(7.5, 1.0, n_legit).clip(100, 50000),     # total_amount
        rng.poisson(2, n_legit).clip(1, 8),                      # diagnosis_count
        rng.poisson(1, n_legit).clip(0, 5),                      # procedure_count
        rng.poisson(1, n_legit).clip(0, 6),                      # drug_count
        rng.poisson(1, n_legit).clip(0, 4),                      # attachment_count
        rng.binomial(1, 0.7, n_legit),                           # has_clinical_notes
        rng.binomial(1, 0.4, n_legit),                           # has_prescription
        rng.exponential(5, n_legit).clip(0, 30),                 # claim_lag_days
        rng.exponential(15, n_legit).clip(0, 90),                # days_since_claim
        rng.integers(0, 5, n_legit),                             # service_weekday (Mon-Fri)
        np.zeros(n_legit),                                        # is_weekend
        rng.integers(8, 18, n_legit),                            # hour_of_service
        np.zeros(n_legit),                                        # amt_per_diag
        np.zeros(n_legit),                                        # amt_per_proc
        rng.integers(0, 6, n_legit),                             # claim_type_code
        rng.integers(0, 64, n_legit),                            # provider_hash_bucket
    ])
    # Compute derived features
    legit[:, 12] = legit[:, 0] / np.maximum(legit[:, 1], 1)  # amt_per_diag
    legit[:, 13] = legit[:, 0] / np.maximum(legit[:, 2], 1)  # amt_per_proc

    # ── Fraudulent claims ───────────────────────────────────────────────────
    fraud = np.column_stack([
        rng.lognormal(9.5, 1.5, n_fraud).clip(5000, 200000),    # high amounts
        rng.poisson(6, n_fraud).clip(3, 20),                      # many diagnoses
        rng.poisson(4, n_fraud).clip(1, 15),                      # many procedures
        rng.poisson(3, n_fraud).clip(0, 12),                      # many drugs
        rng.binomial(1, 0.2, n_fraud),                            # few attachments
        rng.binomial(1, 0.3, n_fraud),                            # less clinical notes
        rng.binomial(1, 0.2, n_fraud),                            # less prescriptions
        rng.exponential(45, n_fraud).clip(0, 180),               # late submissions
        rng.exponential(30, n_fraud).clip(0, 180),               # older claims
        rng.integers(0, 7, n_fraud),                              # any day including weekends
        rng.binomial(1, 0.4, n_fraud),                            # more weekend services
        rng.integers(0, 24, n_fraud),                             # any hour
        np.zeros(n_fraud),                                         # filled below
        np.zeros(n_fraud),                                         # filled below
        rng.integers(0, 6, n_fraud),                              # claim_type_code
        rng.choice([5, 12, 23, 45], n_fraud),                    # concentrated providers
    ])
    fraud[:, 12] = fraud[:, 0] / np.maximum(fraud[:, 1], 1)
    fraud[:, 13] = fraud[:, 0] / np.maximum(fraud[:, 2], 1)

    X = np.vstack([legit, fraud]).astype(np.float32)  # noqa: N806
    y = np.concatenate([np.zeros(n_legit), np.ones(n_fraud)]).astype(np.float32)

    # Shuffle
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


def train_model(
    X: np.ndarray,  # noqa: N803
    y: np.ndarray,
    test_size: float = 0.2,
    seed: int = 42,
) -> tuple[xgb.XGBClassifier, dict]:
    """Train XGBoost classifier and return model + metrics."""
    X_train, X_test, y_train, y_test = train_test_split(  # noqa: N806
        X, y, test_size=test_size, random_state=seed, stratify=y
    )

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        min_child_weight=3,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=len(y_train[y_train == 0]) / max(len(y_train[y_train == 1]), 1),
        eval_metric="aucpr",
        random_state=seed,
        use_label_encoder=False,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=True,
    )

    # Evaluate
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred)),
        "recall": float(recall_score(y_test, y_pred)),
        "f1": float(f1_score(y_test, y_pred)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "n_fraud_train": int(y_train.sum()),
        "n_fraud_test": int(y_test.sum()),
        "feature_importance": dict(
            zip(FEATURE_NAMES, [float(v) for v in model.feature_importances_])
        ),
    }

    print("\n" + "=" * 60)
    print("XGBoost Fraud Classifier — Training Results")
    print("=" * 60)
    print(f"Accuracy:  {metrics['accuracy']:.4f}")
    print(f"Precision: {metrics['precision']:.4f}")
    print(f"Recall:    {metrics['recall']:.4f}")
    print(f"F1 Score:  {metrics['f1']:.4f}")
    print(f"ROC AUC:   {metrics['roc_auc']:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=["Legitimate", "Fraud"]))
    print("\nTop 5 Feature Importances:")
    sorted_fi = sorted(
        metrics["feature_importance"].items(), key=lambda x: x[1], reverse=True
    )
    for name, imp in sorted_fi[:5]:
        print(f"  {name:30s} {imp:.4f}")

    return model, metrics


def upload_to_minio(model_path: Path) -> str:
    """Upload model to MinIO and return the URI."""
    try:
        from minio import Minio

        client = Minio(
            os.environ.get("MINIO_ENDPOINT", "minio.hcx-ai.svc.cluster.local:9000"),
            access_key=os.environ.get("MINIO_ACCESS_KEY", ""),
            secret_key=os.environ.get("MINIO_SECRET_KEY", ""),
            secure=False,
        )
        bucket = "ai-model-weights"
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)

        object_name = "xgb/fraud-v1.json"
        client.fput_object(bucket, object_name, str(model_path))
        uri = f"minio://{bucket}/{object_name}"
        print(f"\nModel uploaded to MinIO: {uri}")
        return uri
    except Exception as exc:
        print(f"\nMinIO upload failed: {exc}")
        print(f"Model saved locally at: {model_path}")
        return str(model_path)


def main():
    parser = argparse.ArgumentParser(description="Train XGBoost fraud classifier")
    parser.add_argument("--upload", action="store_true", help="Upload to MinIO")
    parser.add_argument("--samples", type=int, default=10000, help="Training samples")
    args = parser.parse_args()

    print("Generating synthetic training data...")
    X, y = generate_synthetic_data(n_samples=args.samples)  # noqa: N806
    print(f"Dataset: {len(y)} samples, {int(y.sum())} fraud ({y.mean()*100:.1f}%)")

    print("\nTraining XGBoost classifier...")
    model, metrics = train_model(X, y)

    # Save model and metrics
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))
    print(f"\nModel saved to: {MODEL_PATH}")

    with open(METRICS_PATH, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Metrics saved to: {METRICS_PATH}")

    if args.upload:
        upload_to_minio(MODEL_PATH)

    return 0


if __name__ == "__main__":
    sys.exit(main())
