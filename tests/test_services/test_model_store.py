"""
Tests for the model store (MinIO/file artifact fetcher).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.services.model_store import (
    ModelStoreError,
    clear_cache,
    fetch_to_local,
)


def test_fetch_file_uri(tmp_path: Path):
    src = tmp_path / "fake-model.bin"
    src.write_bytes(b"hello-model")

    clear_cache()
    local = fetch_to_local(f"file://{src}")
    assert local.is_file()
    assert local.read_bytes() == b"hello-model"


def test_fetch_file_uri_cache_reuse(tmp_path: Path):
    src = tmp_path / "fake-model2.bin"
    src.write_bytes(b"v1-contents")

    clear_cache()
    first = fetch_to_local(f"file://{src}")
    # Mutate source after first fetch — cache should still return v1.
    src.write_bytes(b"v2-contents")
    second = fetch_to_local(f"file://{src}")
    assert first == second
    assert first.read_bytes() == b"v1-contents"


def test_fetch_missing_file():
    clear_cache()
    with pytest.raises(ModelStoreError):
        fetch_to_local("file:///definitely/does/not/exist.bin")


def test_fetch_empty_uri():
    with pytest.raises(ModelStoreError):
        fetch_to_local("")


def test_fetch_unsupported_scheme():
    with pytest.raises(ModelStoreError):
        fetch_to_local("ftp://example.com/model.bin")


def test_clear_cache_returns_count(tmp_path: Path):
    src = tmp_path / "m.bin"
    src.write_bytes(b"x")
    clear_cache()
    fetch_to_local(f"file://{src}")
    n = clear_cache()
    assert n >= 1
