"""
Tests for new features: coding_helpers fallback, payer registry, agent timeout config.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest

# ── BUG-04: Coding helpers dual-key fallback ────────────────────────────

def test_extract_icd10_code_new_format():
    """extract_icd10_code returns code from icd10_validations."""
    from src.api.routes._coding_helpers import extract_icd10_code
    result = extract_icd10_code({"icd10_validations": [{"code": "J06.9", "valid": True}]})
    assert result == "J06.9"


def test_extract_icd10_code_old_format():
    """extract_icd10_code falls back to icd10_codes."""
    from src.api.routes._coding_helpers import extract_icd10_code
    result = extract_icd10_code({"icd10_codes": [{"code": "E11.9"}]})
    assert result == "E11.9"


def test_extract_icd10_code_string_list():
    """extract_icd10_code handles string entries in icd10_codes."""
    from src.api.routes._coding_helpers import extract_icd10_code
    result = extract_icd10_code({"icd10_codes": ["M54.5"]})
    assert result == "M54.5"


def test_extract_icd10_code_none():
    """extract_icd10_code returns empty string for None."""
    from src.api.routes._coding_helpers import extract_icd10_code
    result = extract_icd10_code(None)
    assert result == ""


def test_extract_icd10_code_empty_dict():
    """extract_icd10_code returns empty string for empty dict."""
    from src.api.routes._coding_helpers import extract_icd10_code
    result = extract_icd10_code({})
    assert result == ""


def test_extract_icd10_label_new_format():
    """extract_icd10_label returns code-description from icd10_validations."""
    from src.api.routes._coding_helpers import extract_icd10_label
    data = {"icd10_validations": [{"code": "J06.9", "description": "Acute URI"}]}
    result = extract_icd10_label(data)
    assert result == "J06.9 – Acute URI"


def test_extract_icd10_label_code_only():
    """extract_icd10_label returns just code when no description."""
    from src.api.routes._coding_helpers import extract_icd10_label
    result = extract_icd10_label({"icd10_validations": [{"code": "J06.9"}]})
    assert result == "J06.9"


def test_extract_icd10_label_none():
    """extract_icd10_label returns empty for None."""
    from src.api.routes._coding_helpers import extract_icd10_label
    result = extract_icd10_label(None)
    assert result == ""


def test_extract_procedure_name_new_format():
    """extract_procedure_name returns description from procedure_validations."""
    from src.api.routes._coding_helpers import extract_procedure_name
    data = {"procedure_validations": [{"code": "99213", "description": "Office Visit"}]}
    result = extract_procedure_name(data)
    assert result == "Office Visit"


def test_extract_procedure_name_code_fallback():
    """extract_procedure_name falls back to code when no description."""
    from src.api.routes._coding_helpers import extract_procedure_name
    result = extract_procedure_name({"procedure_validations": [{"code": "99213"}]})
    assert result == "99213"


def test_extract_procedure_name_old_format():
    """extract_procedure_name falls back to procedure_codes."""
    from src.api.routes._coding_helpers import extract_procedure_name
    data = {"procedure_codes": [{"code": "71046", "description": "X-Ray"}]}
    result = extract_procedure_name(data)
    assert result == "X-Ray"


def test_extract_procedure_name_none():
    """extract_procedure_name returns empty for None."""
    from src.api.routes._coding_helpers import extract_procedure_name
    result = extract_procedure_name(None)
    assert result == ""


def test_extract_procedure_label_new_format():
    """extract_procedure_label returns code-description."""
    from src.api.routes._coding_helpers import extract_procedure_label
    data = {"procedure_validations": [{"code": "99213", "description": "Office Visit"}]}
    result = extract_procedure_label(data)
    assert result == "99213 – Office Visit"


def test_extract_procedure_label_none():
    """extract_procedure_label returns empty for None."""
    from src.api.routes._coding_helpers import extract_procedure_label
    result = extract_procedure_label(None)
    assert result == ""


def test_extract_code_from_entry_dict():
    """_extract_code_from_entry handles dict."""
    from src.api.routes._coding_helpers import _extract_code_from_entry
    assert _extract_code_from_entry({"code": "J06.9"}) == "J06.9"


def test_extract_code_from_entry_string():
    """_extract_code_from_entry handles string."""
    from src.api.routes._coding_helpers import _extract_code_from_entry
    assert _extract_code_from_entry("J06.9") == "J06.9"


def test_extract_code_from_entry_other():
    """_extract_code_from_entry handles other types."""
    from src.api.routes._coding_helpers import _extract_code_from_entry
    assert _extract_code_from_entry(123) == ""


def test_extract_desc_from_entry_dict():
    """_extract_desc_from_entry handles dict."""
    from src.api.routes._coding_helpers import _extract_desc_from_entry
    assert _extract_desc_from_entry({"description": "Test"}) == "Test"


def test_extract_desc_from_entry_string():
    """_extract_desc_from_entry handles string (returns empty)."""
    from src.api.routes._coding_helpers import _extract_desc_from_entry
    assert _extract_desc_from_entry("test") == ""


# ── FEAT-06: Agent timeout config ───────────────────────────────────────

def test_agent_timeout_default():
    """Settings has agent_timeout_seconds defaulting to 30."""
    from src.config import Settings
    s = Settings(app_env="development")
    assert s.agent_timeout_seconds == 30


def test_agent_timeout_custom():
    """Settings reads AGENT_TIMEOUT_SECONDS from env."""
    os.environ["AGENT_TIMEOUT_SECONDS"] = "15"
    try:
        from src.config import Settings
        s = Settings(app_env="development")
        assert s.agent_timeout_seconds == 15
    finally:
        del os.environ["AGENT_TIMEOUT_SECONDS"]


# ── BUG-08: Payer registry endpoint ─────────────────────────────────────

@pytest.mark.asyncio
async def test_list_payers_endpoint():
    """The /bff/payers endpoint returns a list of payer entries."""
    from src.api.routes.bff import list_payers
    result = await list_payers(_="test")
    assert len(result) >= 6
    ids = [p.payer_id for p in result]
    assert "GIG" in ids
    assert "AXA" in ids


# ── BUG-06: Redis-backed investigation assignments ──────────────────────

@pytest.mark.asyncio
async def test_set_assignment_stores_in_redis():
    """_set_assignment stores value in Redis."""
    from src.api.routes.bff import _set_assignment
    mock_svc = AsyncMock()
    with patch("src.api.routes.bff.RedisService", return_value=mock_svc):
        await _set_assignment("INV-001", "Nadia Farouk")
        mock_svc.setex.assert_called_once()
        args = mock_svc.setex.call_args
        assert "INV-001" in args[0][0]
        assert args[0][2] == "Nadia Farouk"


@pytest.mark.asyncio
async def test_get_assignment_returns_value():
    """_get_assignment retrieves value from Redis."""
    from src.api.routes.bff import _get_assignment
    mock_svc = AsyncMock()
    mock_svc.get.return_value = "Nadia Farouk"
    with patch("src.api.routes.bff.RedisService", return_value=mock_svc):
        result = await _get_assignment("INV-001")
        assert result == "Nadia Farouk"


@pytest.mark.asyncio
async def test_get_assignment_returns_none_when_missing():
    """_get_assignment returns None when key not found."""
    from src.api.routes.bff import _get_assignment
    mock_svc = AsyncMock()
    mock_svc.get.return_value = None
    with patch("src.api.routes.bff.RedisService", return_value=mock_svc):
        result = await _get_assignment("INV-999")
        assert result is None


@pytest.mark.asyncio
async def test_get_assignment_returns_none_on_error():
    """_get_assignment returns None when Redis is unavailable."""
    from src.api.routes.bff import _get_assignment
    with patch("src.api.routes.bff.RedisService", side_effect=Exception("down")):
        result = await _get_assignment("INV-001")
        assert result is None
