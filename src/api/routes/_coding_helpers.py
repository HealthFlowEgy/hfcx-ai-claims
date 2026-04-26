"""
Helpers to extract human-readable ICD-10 and procedure labels from the
``coding_result`` JSONB column persisted in ``ai_claim_analysis``.

The coding agent stores validation results in two possible formats:

    New format (icd10_validations / procedure_validations):
        coding_result.icd10_validations  – list of dicts with keys:
            code, valid, description (optional)
        coding_result.procedure_validations – list of dicts with keys:
            code, valid, description (optional)

    Old format (icd10_codes / procedure_codes):
        coding_result.icd10_codes – list of strings or dicts with ``code`` key
        coding_result.procedure_codes – list of strings or dicts with ``code``/``description`` keys

These helpers try the new format first, then fall back to the old format.
"""
from __future__ import annotations

from typing import Any


def _extract_code_from_entry(entry: Any) -> str:
    """Extract a code string from a list entry that may be a dict or plain string."""
    if isinstance(entry, dict):
        return entry.get("code", "")
    if isinstance(entry, str):
        return entry
    return ""


def _extract_desc_from_entry(entry: Any) -> str:
    """Extract a description string from a list entry that may be a dict or plain string."""
    if isinstance(entry, dict):
        return entry.get("description", "")
    return ""


def extract_icd10_label(coding_result: dict[str, Any] | None) -> str:
    """Return ``"<code> – <description>"`` from coding_result, or ``""``."""
    if not coding_result:
        return ""
    # Try icd10_validations first (new format)
    for entry in coding_result.get("icd10_validations", []):
        code = _extract_code_from_entry(entry)
        desc = _extract_desc_from_entry(entry)
        if code:
            return f"{code} – {desc}" if desc else code
    # Fallback: icd10_codes list (old format)
    for entry in coding_result.get("icd10_codes", []):
        code = _extract_code_from_entry(entry)
        desc = _extract_desc_from_entry(entry)
        if code:
            return f"{code} – {desc}" if desc else code
    return ""


def extract_procedure_label(coding_result: dict[str, Any] | None) -> str:
    """Return ``"<code> – <description>"`` from coding_result, or ``""``."""
    if not coding_result:
        return ""
    # Try procedure_validations first (new format)
    for entry in coding_result.get("procedure_validations", []):
        code = _extract_code_from_entry(entry)
        desc = _extract_desc_from_entry(entry)
        if code:
            return f"{code} – {desc}" if desc else code
    # Fallback: procedure_codes list (old format)
    for entry in coding_result.get("procedure_codes", []):
        code = _extract_code_from_entry(entry)
        desc = _extract_desc_from_entry(entry)
        if code:
            return f"{code} – {desc}" if desc else code
    return ""


def extract_icd10_code(coding_result: dict[str, Any] | None) -> str:
    """Return just the first ICD-10 code, or ``""``."""
    if not coding_result:
        return ""
    # Try icd10_validations first (new format)
    for entry in coding_result.get("icd10_validations", []):
        code = _extract_code_from_entry(entry)
        if code:
            return code
    # Fallback: icd10_codes list (old format)
    for entry in coding_result.get("icd10_codes", []):
        code = _extract_code_from_entry(entry)
        if code:
            return code
    return ""


def extract_procedure_name(coding_result: dict[str, Any] | None) -> str:
    """Return the first procedure description, or ``""``."""
    if not coding_result:
        return ""
    # Try procedure_validations first (new format)
    for entry in coding_result.get("procedure_validations", []):
        desc = _extract_desc_from_entry(entry)
        if desc:
            return desc
        code = _extract_code_from_entry(entry)
        if code:
            return code
    # Fallback: procedure_codes list (old format)
    for entry in coding_result.get("procedure_codes", []):
        desc = _extract_desc_from_entry(entry)
        if desc:
            return desc
        code = _extract_code_from_entry(entry)
        if code:
            return code
    return ""
