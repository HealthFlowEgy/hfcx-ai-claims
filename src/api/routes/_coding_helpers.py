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


# ── Static code-to-name lookup (loaded once) ─────────────────────────────

_ICD10_NAMES: dict[str, str] = {}
_CPT_NAMES: dict[str, str] = {}
_LOOKUP_LOADED = False


def _ensure_lookup_loaded() -> None:
    """Lazily load ICD-10 and CPT name lookup tables from data files."""
    global _LOOKUP_LOADED
    if _LOOKUP_LOADED:
        return
    import csv
    from pathlib import Path

    # __file__ = src/api/routes/_coding_helpers.py
    # Data lives at src/data/, i.e. three levels up from routes/
    data_dir = Path(__file__).resolve().parent.parent.parent / "data"

    # ICD-10
    icd_path = data_dir / "icd10cm-codes-2026.txt"
    if icd_path.exists():
        with open(icd_path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                parts = line.split(None, 1)
                if len(parts) == 2:
                    raw_code = parts[0].strip()
                    desc = parts[1].strip()
                    if len(raw_code) > 3:
                        code = raw_code[:3] + "." + raw_code[3:]
                    else:
                        code = raw_code
                    _ICD10_NAMES[code.upper()] = desc

    # CPT
    cpt_path = data_dir / "cpt4_raw.csv"
    if cpt_path.exists():
        with open(cpt_path, encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)  # skip header
            for row in reader:
                if len(row) >= 2:
                    code = row[0].strip()
                    desc = row[1].strip()
                    if code and desc:
                        _CPT_NAMES[code.upper()] = desc

    _LOOKUP_LOADED = True


def lookup_icd10_name(code: str) -> str:
    """Return the human-readable name for an ICD-10 code, or ``""``."""
    _ensure_lookup_loaded()
    return _ICD10_NAMES.get(code.upper().strip(), "")


def lookup_cpt_name(code: str) -> str:
    """Return the human-readable name for a CPT/HCPCS code, or ``""``."""
    _ensure_lookup_loaded()
    return _CPT_NAMES.get(code.upper().strip(), "")
