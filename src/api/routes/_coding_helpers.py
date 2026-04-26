"""
Helpers to extract human-readable ICD-10 and procedure labels from the
``coding_result`` JSONB column persisted in ``ai_claim_analysis``.

The coding agent stores validation results in two lists:

    coding_result.icd10_validations  – list of dicts with keys:
        code, valid, description (optional)
    coding_result.procedure_validations – list of dicts with keys:
        code, valid, description (optional)

These helpers return the first code+description found, or a sensible
fallback when the JSONB is empty or missing.
"""
from __future__ import annotations

from typing import Any


def extract_icd10_label(coding_result: dict[str, Any] | None) -> str:
    """Return ``"<code> – <description>"`` from coding_result, or ``""``."""
    if not coding_result:
        return ""
    for entry in coding_result.get("icd10_validations", []):
        code = entry.get("code", "")
        desc = entry.get("description", "")
        if code:
            return f"{code} – {desc}" if desc else code
    return ""


def extract_procedure_label(coding_result: dict[str, Any] | None) -> str:
    """Return ``"<code> – <description>"`` from coding_result, or ``""``."""
    if not coding_result:
        return ""
    for entry in coding_result.get("procedure_validations", []):
        code = entry.get("code", "")
        desc = entry.get("description", "")
        if code:
            return f"{code} – {desc}" if desc else code
    return ""


def extract_icd10_code(coding_result: dict[str, Any] | None) -> str:
    """Return just the first ICD-10 code, or ``""``."""
    if not coding_result:
        return ""
    for entry in coding_result.get("icd10_validations", []):
        code = entry.get("code", "")
        if code:
            return code
    return ""


def extract_procedure_name(coding_result: dict[str, Any] | None) -> str:
    """Return the first procedure description, or ``""``."""
    if not coding_result:
        return ""
    for entry in coding_result.get("procedure_validations", []):
        desc = entry.get("description", "")
        if desc:
            return desc
        code = entry.get("code", "")
        if code:
            return code
    return ""
