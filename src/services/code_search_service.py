"""
Medical Code Search Service — ICD-10-CM & CPT/HCPCS code lookup.

Loads the full FY2026 ICD-10-CM code set (74,719 codes) and CPT-4
procedure codes (8,222 codes) into memory at startup. Provides fast
prefix and substring search for the Provider Portal autocomplete.

Data sources:
  - ICD-10-CM: CDC FY2026 icd10cm-codes-2026.txt
  - CPT-4: Community CPT4 CSV (lieldulev/cpt4.csv)
"""
from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import structlog

log = structlog.get_logger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True, slots=True)
class CodeEntry:
    code: str
    description: str


class CodeSearchService:
    """Singleton service for medical code search."""

    _instance: CodeSearchService | None = None
    _icd10_codes: list[CodeEntry]
    _cpt_codes: list[CodeEntry]

    def __init__(self) -> None:
        self._icd10_codes = []
        self._cpt_codes = []

    @classmethod
    def get_instance(cls) -> CodeSearchService:
        if cls._instance is None:
            cls._instance = cls()
            cls._instance._load_all()
        return cls._instance

    def _load_all(self) -> None:
        self._load_icd10()
        self._load_cpt()

    def _load_icd10(self) -> None:
        """Load ICD-10-CM codes from the CDC FY2026 codes file."""
        path = DATA_DIR / "icd10cm-codes-2026.txt"
        if not path.exists():
            log.warning("icd10_file_not_found", path=str(path))
            return

        codes: list[CodeEntry] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                parts = line.split(None, 1)
                if len(parts) == 2:
                    raw_code = parts[0].strip()
                    desc = parts[1].strip()
                    # Add dot after 3rd character (A009 → A00.9)
                    if len(raw_code) > 3:
                        code = raw_code[:3] + "." + raw_code[3:]
                    else:
                        code = raw_code
                    codes.append(CodeEntry(code=code, description=desc))

        self._icd10_codes = codes
        log.info("icd10_codes_loaded", count=len(codes))

    def _load_cpt(self) -> None:
        """Load CPT-4 procedure codes from CSV."""
        path = DATA_DIR / "cpt4_raw.csv"
        if not path.exists():
            log.warning("cpt_file_not_found", path=str(path))
            return

        codes: list[CodeEntry] = []
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)  # skip header
            for row in reader:
                if len(row) >= 2:
                    code = row[0].strip()
                    desc = row[1].strip()
                    if code and desc:
                        codes.append(CodeEntry(code=code, description=desc))

        codes.sort(key=lambda c: c.code)
        self._cpt_codes = codes
        log.info("cpt_codes_loaded", count=len(codes))

    def search(
        self,
        query: str,
        code_type: Literal["icd10", "cpt"] = "icd10",
        limit: int = 15,
    ) -> list[dict]:
        """
        Search codes by prefix or substring match.

        Priority:
          1. Exact code match
          2. Code prefix match
          3. Description substring match (case-insensitive)
        """
        codes = self._icd10_codes if code_type == "icd10" else self._cpt_codes
        q = query.strip().upper() if code_type == "icd10" else query.strip()
        q_lower = q.lower()

        if not q:
            # Return first N codes when query is empty
            return [
                {"code": c.code, "description": c.description}
                for c in codes[:limit]
            ]

        exact: list[dict] = []
        prefix: list[dict] = []
        substring: list[dict] = []

        for entry in codes:
            code_upper = entry.code.upper()
            if code_upper == q:
                exact.append(
                    {"code": entry.code, "description": entry.description}
                )
            elif code_upper.startswith(q):
                prefix.append(
                    {"code": entry.code, "description": entry.description}
                )
            elif (
                q_lower in entry.description.lower()
                or q_lower in entry.code.lower()
            ):
                substring.append(
                    {"code": entry.code, "description": entry.description}
                )

            # Early exit if we have enough results
            if len(exact) + len(prefix) + len(substring) >= limit * 3:
                break

        results = exact + prefix + substring
        return results[:limit]

    @property
    def icd10_count(self) -> int:
        return len(self._icd10_codes)

    @property
    def cpt_count(self) -> int:
        return len(self._cpt_codes)
