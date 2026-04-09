"""Structlog configuration with deep PHI redaction (SEC-005)."""
from __future__ import annotations

import logging
from typing import Any

import structlog

from src.utils.phi_redactor import PHIRedactor

_redactor = PHIRedactor()


def _phi_redaction_processor(
    logger: Any, method: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """
    Walk the event dict recursively and redact every PHI match.

    Applies to strings (regex), nested dicts / lists, and to any value
    whose key name matches the sensitive-keys set in PHIRedactor.
    """
    return {k: _redactor.redact_value(k, v) for k, v in event_dict.items()}


def configure_logging(log_level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _phi_redaction_processor,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
    )
