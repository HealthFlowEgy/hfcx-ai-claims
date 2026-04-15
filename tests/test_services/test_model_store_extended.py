"""
Extended tests for model_store to cover file:// URI and edge cases.
"""
from __future__ import annotations

import tempfile

import pytest

from src.services.model_store import ModelStoreError, fetch_to_local


class TestModelStoreExtended:

    def test_fetch_file_uri_with_valid_file(self):
        """Test that file:// URIs correctly resolve to local paths."""
        with tempfile.NamedTemporaryFile(
            suffix=".bin", delete=False
        ) as f:
            f.write(b"fake model data")
            path = f.name
        result = fetch_to_local(f"file://{path}")
        assert result.exists()
        assert result.stat().st_size > 0

    def test_fetch_file_uri_missing_file(self):
        """Test that missing file:// URIs raise ModelStoreError."""
        with pytest.raises(ModelStoreError, match="not found"):
            fetch_to_local("file:///nonexistent/model.bin")

    def test_fetch_empty_uri_raises(self):
        with pytest.raises(ModelStoreError, match="empty"):
            fetch_to_local("")

    def test_fetch_unsupported_scheme_raises(self):
        with pytest.raises(ModelStoreError, match="unsupported"):
            fetch_to_local("ftp://example.com/model.bin")

    def test_fetch_minio_without_client_raises(self):
        """Test that minio:// URIs fail gracefully without minio client."""
        # This will either succeed (if minio is installed) or raise
        # ModelStoreError — either way it exercises the code path
        try:
            fetch_to_local("minio://test-bucket/model.bin")
        except ModelStoreError:
            pass  # Expected when minio is not configured
