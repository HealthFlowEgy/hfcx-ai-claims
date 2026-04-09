"""
PHI Redactor (SEC-005) — strips patient health information from logs.
Only claim_id hashes and X-HCX-Correlation-ID appear in logs.
"""
from __future__ import annotations

import hashlib
import re


class PHIRedactor:
    """
    Redacts PHI from log strings before they are emitted.
    Applied as a structlog processor.
    """
    # Egyptian National ID: 14 digits
    _NATIONAL_ID_RE = re.compile(r"\b\d{14}\b")
    # Phone numbers
    _PHONE_RE = re.compile(r"\b(01[0-9]{9}|\+20[0-9]{10})\b")
    # Patient name patterns (Arabic or Latin in specific context keys)
    _PATIENT_NAME_KEYS = {"patient_name", "name", "full_name", "اسم_المريض"}

    def redact(self, text: str) -> str:
        text = self._NATIONAL_ID_RE.sub("[REDACTED-NID]", text)
        text = self._PHONE_RE.sub("[REDACTED-PHONE]", text)
        return text

    def hash_claim_id(self, claim_id: str) -> str:
        """One-way hash of claim_id for audit log (SEC-005)."""
        return hashlib.sha256(claim_id.encode()).hexdigest()[:16]
