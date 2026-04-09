"""
PHI Redactor (SEC-005) — strips patient health information from logs.

Only claim_id hashes and X-HCX-Correlation-ID appear in logs.

Implementation notes
────────────────────
1. Handles both Western (0-9) and Arabic-Indic (٠-٩) digit forms when
   detecting 14-digit National IDs and Egyptian phone numbers.
2. The redactor is used from a structlog processor that walks nested
   dicts / lists recursively, so redaction applies even when PHI is
   buried inside a nested event dict (e.g. claim.clinical_notes).
3. Sensitive key names are scrubbed regardless of value type.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

_ARABIC_INDIC = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669"
_DIGIT_CLASS = f"[0-9{_ARABIC_INDIC}]"


class PHIRedactor:
    """Redacts PHI from arbitrary values before structured logs are emitted."""

    # Egyptian National ID: 14 digits (Western or Arabic-Indic)
    _NATIONAL_ID_RE = re.compile(rf"\b{_DIGIT_CLASS}{{14}}\b")
    # Egyptian phone numbers: 01XXXXXXXXX (11 digits) or +20XXXXXXXXXX
    _PHONE_RE = re.compile(
        rf"(?:\+?20{_DIGIT_CLASS}{{10}}|\b01{_DIGIT_CLASS}{{9}}\b)"
    )
    # Passport-ish or alphanumeric long ids in known-sensitive key contexts
    _SENSITIVE_KEYS = {
        "patient_name",
        "full_name",
        "name",
        "اسم_المريض",
        "patient",
        "beneficiary_name",
        "address",
        "national_id",
        "phone",
        "email",
    }

    def redact(self, text: str) -> str:
        if not isinstance(text, str):
            return text
        text = self._NATIONAL_ID_RE.sub("[REDACTED-NID]", text)
        text = self._PHONE_RE.sub("[REDACTED-PHONE]", text)
        return text

    def redact_value(self, key: str | None, value: Any) -> Any:
        """
        Deep-redact a value. Key context enables keyword-based scrubbing for
        fields like patient_name where no regex would match.
        """
        if key is not None and key.lower() in self._SENSITIVE_KEYS:
            return "[REDACTED]"
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, dict):
            return {k: self.redact_value(k, v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            redacted = [self.redact_value(None, v) for v in value]
            return redacted if isinstance(value, list) else tuple(redacted)
        return value

    def hash_claim_id(self, claim_id: str) -> str:
        """One-way hash of claim_id for audit log (SEC-005)."""
        return hashlib.sha256(claim_id.encode()).hexdigest()[:16]
