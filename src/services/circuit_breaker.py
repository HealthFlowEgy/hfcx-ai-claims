"""
Circuit breakers — native asyncio implementation (FR-AO-004 / NFR-004).

A small, self-contained state machine that avoids the pybreaker +
Tornado coupling. One instance per external dependency (LLM gateway,
HFCX registry, NDP, ChromaDB) so a single slow backend cannot
cascade into the rest of the pipeline.

State machine
─────────────
    closed  ──[fail_max consecutive failures]──▶  open
    open    ──[reset_timeout elapsed]─────────▶  half_open
    half_open ──[next call succeeds]──────────▶  closed
    half_open ──[next call fails]─────────────▶  open

Half-open only allows a single trial call; additional concurrent
callers while half-open see an `open` state until that trial completes.

All transitions are guarded by an asyncio.Lock so state is consistent
under load. Trips increment a Prometheus counter for dashboarding.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from enum import StrEnum
from typing import Any, TypeVar

import structlog

from src.config import get_settings
from src.utils.metrics import CIRCUIT_BREAKER_TRIPS

log = structlog.get_logger(__name__)
settings = get_settings()

T = TypeVar("T")


class BreakerState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerError(Exception):
    """Raised when a call is refused because the breaker is OPEN."""


class AsyncCircuitBreaker:
    """
    Process-wide asyncio circuit breaker.

    Parameters
    ----------
    name: human-readable identifier (used in logs + metric labels)
    fail_max: consecutive failures required to trip from closed to open
    reset_timeout: seconds to wait before transitioning from open to half-open
    """

    def __init__(
        self,
        name: str,
        fail_max: int = 5,
        reset_timeout: float = 30.0,
    ) -> None:
        self.name = name
        self.fail_max = fail_max
        self.reset_timeout = reset_timeout

        self._state: BreakerState = BreakerState.CLOSED
        self._fail_count: int = 0
        self._opened_at: float = 0.0
        self._half_open_trial_in_flight: bool = False
        self._lock: asyncio.Lock | None = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    @property
    def state(self) -> BreakerState:
        return self._state

    @property
    def current_state(self) -> str:
        """Backwards-compat alias matching the old pybreaker API."""
        return self._state.value

    @property
    def fail_count(self) -> int:
        return self._fail_count

    async def _transition_to(self, new_state: BreakerState) -> None:
        """Change state + log + emit metric. Caller must hold the lock."""
        if self._state == new_state:
            return
        old = self._state
        self._state = new_state
        log.warning(
            "circuit_breaker_state_change",
            breaker=self.name,
            old=old.value,
            new=new_state.value,
        )
        if new_state == BreakerState.OPEN:
            CIRCUIT_BREAKER_TRIPS.labels(breaker=self.name).inc()

    async def _before_call(self) -> None:
        """
        Decide whether a call is allowed. Raises CircuitBreakerError if
        the breaker rejects the call.
        """
        async with self._get_lock():
            if self._state == BreakerState.CLOSED:
                return

            if self._state == BreakerState.OPEN:
                elapsed = time.monotonic() - self._opened_at
                if elapsed >= self.reset_timeout:
                    # Transition to half-open and allow a single trial call.
                    await self._transition_to(BreakerState.HALF_OPEN)
                    self._half_open_trial_in_flight = True
                    return
                raise CircuitBreakerError(
                    f"circuit breaker '{self.name}' is open"
                )

            if self._state == BreakerState.HALF_OPEN:
                if self._half_open_trial_in_flight:
                    raise CircuitBreakerError(
                        f"circuit breaker '{self.name}' half-open trial in flight"
                    )
                self._half_open_trial_in_flight = True
                return

    async def _on_success(self) -> None:
        async with self._get_lock():
            if self._state == BreakerState.HALF_OPEN:
                # Trial succeeded — close the breaker.
                await self._transition_to(BreakerState.CLOSED)
                self._half_open_trial_in_flight = False
                self._fail_count = 0
            elif self._state == BreakerState.CLOSED:
                # Reset consecutive-failure counter on any success.
                self._fail_count = 0

    async def _on_failure(self) -> None:
        async with self._get_lock():
            if self._state == BreakerState.HALF_OPEN:
                # Trial failed — re-open immediately.
                self._opened_at = time.monotonic()
                await self._transition_to(BreakerState.OPEN)
                self._half_open_trial_in_flight = False
                return

            if self._state == BreakerState.CLOSED:
                self._fail_count += 1
                if self._fail_count >= self.fail_max:
                    self._opened_at = time.monotonic()
                    await self._transition_to(BreakerState.OPEN)

    async def call(
        self,
        func: Callable[..., Awaitable[T]],
        *args: Any,
        **kwargs: Any,
    ) -> T:
        """
        Execute ``func(*args, **kwargs)`` through this breaker.

        Raises
        ------
        CircuitBreakerError: breaker is open and not ready for a trial call.
        Exception: any exception from ``func`` is re-raised unchanged.
        """
        await self._before_call()
        try:
            result = await func(*args, **kwargs)
        except Exception:
            await self._on_failure()
            raise
        await self._on_success()
        return result

    # Test/ops hook: reset state without touching metrics.
    async def reset(self) -> None:
        async with self._get_lock():
            self._state = BreakerState.CLOSED
            self._fail_count = 0
            self._opened_at = 0.0
            self._half_open_trial_in_flight = False


def _build(name: str) -> AsyncCircuitBreaker:
    return AsyncCircuitBreaker(
        name=name,
        fail_max=settings.circuit_breaker_fail_max,
        reset_timeout=float(settings.circuit_breaker_reset_timeout_seconds),
    )


# Module-level singletons — one per external dependency.
LLM_BREAKER = _build("litellm")
REGISTRY_BREAKER = _build("hfcx_registry")
NDP_BREAKER = _build("ndp")
CHROMA_BREAKER = _build("chromadb")


async def call_async_breaker(
    breaker: AsyncCircuitBreaker,
    func: Callable[..., Awaitable[T]],
    *args: Any,
    **kwargs: Any,
) -> T:
    """
    Backwards-compatible helper so existing callers in the codebase keep
    working without touching their call sites.
    """
    return await breaker.call(func, *args, **kwargs)
