"""Structlog configuration with PHI redaction processor."""
from __future__ import annotations

import logging
import structlog
from src.utils.phi_redactor import PHIRedactor

_redactor = PHIRedactor()


def _phi_redaction_processor(logger, method, event_dict):
    """Structlog processor: redact PHI from all log values (SEC-005)."""
    for key, value in event_dict.items():
        if isinstance(value, str):
            event_dict[key] = _redactor.redact(value)
    return event_dict


def configure_logging(log_level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
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
