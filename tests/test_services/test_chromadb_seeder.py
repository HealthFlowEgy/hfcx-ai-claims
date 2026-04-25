"""Tests for src.services.chromadb_seeder."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.services.chromadb_seeder import (
    DEMO_EDA_ENTRIES,
    DEMO_GUIDELINES_ENTRIES,
    _seed_collection_if_empty,
    seed_chromadb_if_empty,
)

# ── seed_chromadb_if_empty ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_seed_skipped_when_chromadb_unreachable():
    """Should log warning and return when ChromaDB is not reachable."""
    with patch(
        "src.services.chromadb_seeder.chromadb.HttpClient"
    ) as mock_cls:
        mock_client = MagicMock()
        mock_client.heartbeat.side_effect = Exception("conn refused")
        mock_cls.return_value = mock_client

        # Should not raise
        await seed_chromadb_if_empty()
        mock_client.heartbeat.assert_called_once()


@pytest.mark.asyncio
async def test_seed_calls_seed_for_both_collections():
    """Should seed both collections when ChromaDB is reachable."""
    with (
        patch(
            "src.services.chromadb_seeder.chromadb.HttpClient"
        ) as mock_cls,
        patch(
            "src.services.chromadb_seeder._seed_collection_if_empty"
        ) as mock_seed,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client

        await seed_chromadb_if_empty()

        assert mock_seed.call_count == 2


@pytest.mark.asyncio
async def test_seed_tolerates_seed_error():
    """Should catch and log errors during seeding."""
    with (
        patch(
            "src.services.chromadb_seeder.chromadb.HttpClient"
        ) as mock_cls,
        patch(
            "src.services.chromadb_seeder._seed_collection_if_empty",
            side_effect=Exception("boom"),
        ),
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client

        # Should not raise
        await seed_chromadb_if_empty()


# ── _seed_collection_if_empty ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_seed_collection_skips_when_not_empty():
    """Should skip seeding when collection already has documents."""
    mock_client = MagicMock()
    mock_collection = MagicMock()
    mock_collection.count.return_value = 10
    mock_client.get_or_create_collection.return_value = mock_collection

    await _seed_collection_if_empty(
        mock_client, "clinical_guidelines", DEMO_GUIDELINES_ENTRIES
    )

    mock_collection.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_seed_collection_upserts_when_empty():
    """Should upsert entries when collection is empty."""
    mock_client = MagicMock()
    mock_collection = MagicMock()
    mock_collection.count.side_effect = [0, 12]
    mock_client.get_or_create_collection.return_value = mock_collection

    await _seed_collection_if_empty(
        mock_client, "clinical_guidelines", DEMO_GUIDELINES_ENTRIES
    )

    mock_collection.upsert.assert_called_once()
    call_kwargs = mock_collection.upsert.call_args
    assert len(call_kwargs.kwargs["ids"]) == len(
        DEMO_GUIDELINES_ENTRIES
    )


@pytest.mark.asyncio
async def test_seed_eda_collection_when_empty():
    """Should upsert EDA entries when collection is empty."""
    mock_client = MagicMock()
    mock_collection = MagicMock()
    mock_collection.count.side_effect = [0, 5]
    mock_client.get_or_create_collection.return_value = mock_collection

    await _seed_collection_if_empty(
        mock_client, "eda_formulary", DEMO_EDA_ENTRIES
    )

    mock_collection.upsert.assert_called_once()
    call_kwargs = mock_collection.upsert.call_args
    assert len(call_kwargs.kwargs["ids"]) == len(DEMO_EDA_ENTRIES)


# ── Data integrity ──────────────────────────────────────────────────────


def test_guidelines_entries_have_required_fields():
    """Each guideline entry must have id, text, and metadata."""
    for entry in DEMO_GUIDELINES_ENTRIES:
        assert "id" in entry
        assert "text" in entry
        assert "metadata" in entry
        assert isinstance(entry["metadata"], dict)


def test_eda_entries_have_required_fields():
    """Each EDA entry must have id, text, and metadata."""
    for entry in DEMO_EDA_ENTRIES:
        assert "id" in entry
        assert "text" in entry
        assert "metadata" in entry
        assert isinstance(entry["metadata"], dict)


def test_all_ids_unique():
    """All entry IDs across both collections must be unique."""
    all_ids = [e["id"] for e in DEMO_GUIDELINES_ENTRIES] + [
        e["id"] for e in DEMO_EDA_ENTRIES
    ]
    assert len(all_ids) == len(set(all_ids))
