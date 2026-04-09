"""
Model store — load ML model artifacts from MinIO / S3-compatible storage
(SEC-004 encrypted-at-rest model weights).

Currently used for the XGBoost supervised fraud classifier (Phase 2,
gated behind `settings.xgboost_enabled`). The same module is intended
to serve future model artifacts (drift-feedback retrained weights,
multimodal adapters, etc.) so they all go through one audited path.

URI format
──────────
The store accepts either:
  - ``minio://bucket/key``       — use the configured MinIO endpoint
  - ``file:///abs/path``         — local file (dev / tests)
  - ``s3://bucket/key``          — AWS S3 (if boto3 is present — not a
                                    runtime dependency of hfcx-ai-claims;
                                    the plain minio path is preferred)
"""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()


class ModelStoreError(Exception):
    """Raised when a model artifact cannot be fetched or verified."""


def fetch_to_local(uri: str) -> Path:
    """
    Fetch ``uri`` into a deterministic local cache path. Returns the
    Path. Raises ModelStoreError on failure.

    The caller is expected to load the artifact from the returned path
    (e.g. ``xgb.Booster().load_model(str(path))``). Cached files are
    reused on subsequent calls unless they have been manually deleted.
    """
    if not uri:
        raise ModelStoreError("empty model URI")

    parsed = urlparse(uri)
    scheme = parsed.scheme.lower()

    # deterministic cache path
    digest = hashlib.sha256(uri.encode()).hexdigest()[:16]
    cache_dir = Path(tempfile.gettempdir()) / "hfcx-ai-model-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    local_path = cache_dir / f"{digest}-{Path(parsed.path).name or 'artifact'}"

    if local_path.exists() and local_path.stat().st_size > 0:
        log.debug("model_store_cache_hit", uri=uri, local=str(local_path))
        return local_path

    if scheme in ("file", ""):
        src = Path(parsed.path)
        if not src.is_file():
            raise ModelStoreError(f"local model file not found: {src}")
        local_path.write_bytes(src.read_bytes())
        log.info("model_store_local_copy", src=str(src), dst=str(local_path))
        return local_path

    if scheme == "minio":
        _fetch_minio(parsed.netloc, parsed.path.lstrip("/"), local_path)
        return local_path

    if scheme == "s3":
        _fetch_s3(parsed.netloc, parsed.path.lstrip("/"), local_path)
        return local_path

    raise ModelStoreError(f"unsupported model URI scheme: {scheme}")


def _fetch_minio(bucket: str, key: str, dst: Path) -> None:
    try:
        from minio import Minio
    except ImportError as exc:
        raise ModelStoreError(
            "minio client is not installed — cannot fetch minio:// URIs. "
            "Either install the `minio` package or set XGBOOST_MODEL_URI "
            "to a file:// URL for local development."
        ) from exc

    endpoint = settings.minio_endpoint
    client = Minio(
        endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    try:
        client.fget_object(bucket, key, str(dst))
    except Exception as exc:
        raise ModelStoreError(
            f"failed to fetch minio://{bucket}/{key}: {exc}"
        ) from exc
    log.info("model_store_minio_fetch", bucket=bucket, key=key, dst=str(dst))


def _fetch_s3(bucket: str, key: str, dst: Path) -> None:
    try:
        import boto3
    except ImportError as exc:
        raise ModelStoreError(
            "boto3 is not installed — cannot fetch s3:// URIs. Use minio:// "
            "or file:// instead."
        ) from exc
    try:
        s3 = boto3.client("s3")
        s3.download_file(bucket, key, str(dst))
    except Exception as exc:
        raise ModelStoreError(
            f"failed to fetch s3://{bucket}/{key}: {exc}"
        ) from exc
    log.info("model_store_s3_fetch", bucket=bucket, key=key, dst=str(dst))


def clear_cache() -> int:
    """Remove cached artifacts. Returns the number of files deleted."""
    cache_dir = Path(tempfile.gettempdir()) / "hfcx-ai-model-cache"
    if not cache_dir.exists():
        return 0
    n = 0
    for p in cache_dir.iterdir():
        try:
            os.remove(p)
            n += 1
        except OSError:
            pass
    return n
