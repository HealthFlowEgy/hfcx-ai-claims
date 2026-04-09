"""
Shared circuit breakers (FR-AO-004 / NFR-004).

pybreaker provides a proper state machine (closed → open → half-open) but its
built-in `call_async` depends on Tornado. We use pybreaker for the state
tracking + listeners and wrap it in a small asyncio helper
(`call_async_breaker`) that checks the state and records success/failure using
pybreaker's public API.

Design:
  - Each external dependency has its own breaker (LLM gateway, HFCX registry,
    NDP, ChromaDB) so a single slow backend does not trip the others.
  - Breakers are module-level singletons — state is shared across all
    request handlers in a process.
  - Breaker trips increment a Prometheus counter for dashboard alerting.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, TypeVar

import pybreaker
import structlog

from src.config import get_settings
from src.utils.metrics import CIRCUIT_BREAKER_TRIPS

log = structlog.get_logger(__name__)
settings = get_settings()

T = TypeVar("T")


class _TripListener(pybreaker.CircuitBreakerListener):
    def __init__(self, name: str) -> None:
        self._name = name

    def state_change(
        self,
        cb: pybreaker.CircuitBreaker,
        old_state: Any,
        new_state: Any,
    ) -> None:
        log.warning(
            "circuit_breaker_state_change",
            breaker=self._name,
            old=getattr(old_state, "name", str(old_state)),
            new=getattr(new_state, "name", str(new_state)),
        )
        if getattr(new_state, "name", "") == "open":
            CIRCUIT_BREAKER_TRIPS.labels(breaker=self._name).inc()


def _build(name: str) -> pybreaker.CircuitBreaker:
    return pybreaker.CircuitBreaker(
        fail_max=settings.circuit_breaker_fail_max,
        reset_timeout=settings.circuit_breaker_reset_timeout_seconds,
        name=name,
        listeners=[_TripListener(name)],
    )


LLM_BREAKER = _build("litellm")
REGISTRY_BREAKER = _build("hfcx_registry")
NDP_BREAKER = _build("ndp")
CHROMA_BREAKER = _build("chromadb")


async def call_async_breaker(
    breaker: pybreaker.CircuitBreaker,
    func: Callable[..., Awaitable[T]],
    *args: Any,
    **kwargs: Any,
) -> T:
    """
    asyncio-compatible wrapper that respects the breaker state machine.

    - When the breaker is OPEN we refuse the call immediately (fail-fast).
    - On success the failure counter is cleared (pybreaker public API:
      ``breaker._state_storage.reset_counter`` is private, so we use the
      supported ``call`` method against a no-op lambda to pulse the state).
    - On failure we bump the counter via the same mechanism and re-raise.
    """
    if breaker.current_state == "open":
        raise pybreaker.CircuitBreakerError(
            f"circuit breaker '{breaker.name}' is open"
        )

    try:
        result = await func(*args, **kwargs)
    except pybreaker.CircuitBreakerError:
        raise
    except Exception as exc:
        try:
            # Register failure via the breaker's sync .call on a failing stub.
            breaker.call(_raise_as, exc)
        except Exception:
            pass
        raise

    # Register success via breaker.call on a no-op — keeps counters consistent.
    try:
        breaker.call(lambda: None)
    except Exception:
        pass
    return result


def _raise_as(exc: BaseException) -> None:
    raise exc
