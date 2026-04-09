"""
Tests for the native asyncio circuit breaker
(src/services/circuit_breaker.py).

We verify the full state machine: closed → open → half_open → closed,
and that concurrent callers are serialized through the trial call.
"""
from __future__ import annotations

import asyncio

import pytest

from src.services.circuit_breaker import (
    AsyncCircuitBreaker,
    BreakerState,
    CircuitBreakerError,
    call_async_breaker,
)


async def _fail() -> None:
    raise RuntimeError("boom")


async def _succeed() -> str:
    return "ok"


@pytest.mark.asyncio
async def test_closed_to_open_after_fail_max():
    breaker = AsyncCircuitBreaker("t1", fail_max=3, reset_timeout=60)

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await breaker.call(_fail)

    assert breaker.state == BreakerState.OPEN


@pytest.mark.asyncio
async def test_open_rejects_calls_with_breaker_error():
    breaker = AsyncCircuitBreaker("t2", fail_max=1, reset_timeout=60)

    with pytest.raises(RuntimeError):
        await breaker.call(_fail)

    assert breaker.state == BreakerState.OPEN
    with pytest.raises(CircuitBreakerError):
        await breaker.call(_succeed)


@pytest.mark.asyncio
async def test_reset_timeout_moves_to_half_open_then_closed():
    breaker = AsyncCircuitBreaker("t3", fail_max=1, reset_timeout=0.05)
    with pytest.raises(RuntimeError):
        await breaker.call(_fail)
    assert breaker.state == BreakerState.OPEN

    await asyncio.sleep(0.1)  # past reset_timeout

    result = await breaker.call(_succeed)
    assert result == "ok"
    assert breaker.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_half_open_trial_failure_reopens():
    breaker = AsyncCircuitBreaker("t4", fail_max=1, reset_timeout=0.05)
    with pytest.raises(RuntimeError):
        await breaker.call(_fail)

    await asyncio.sleep(0.1)

    with pytest.raises(RuntimeError):
        await breaker.call(_fail)
    assert breaker.state == BreakerState.OPEN


@pytest.mark.asyncio
async def test_success_resets_closed_fail_counter():
    breaker = AsyncCircuitBreaker("t5", fail_max=5, reset_timeout=60)

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await breaker.call(_fail)

    assert breaker.fail_count == 3
    assert breaker.state == BreakerState.CLOSED

    await breaker.call(_succeed)
    assert breaker.fail_count == 0
    assert breaker.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_concurrent_half_open_trial_serialization():
    breaker = AsyncCircuitBreaker("t6", fail_max=1, reset_timeout=0.05)
    with pytest.raises(RuntimeError):
        await breaker.call(_fail)

    await asyncio.sleep(0.1)

    # Two concurrent calls while breaker is ready to half-open:
    #   - one should become the trial (succeed → close)
    #   - the other should be rejected because a trial is in flight
    slow_call_started = asyncio.Event()

    async def _slow_ok() -> str:
        slow_call_started.set()
        await asyncio.sleep(0.02)
        return "ok"

    async def _delayed_second() -> None:
        # Wait for the first trial to start before attempting to call.
        await slow_call_started.wait()

    trial = asyncio.create_task(breaker.call(_slow_ok))
    await _delayed_second()
    with pytest.raises(CircuitBreakerError):
        await breaker.call(_succeed)

    assert await trial == "ok"
    assert breaker.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_reset_returns_to_closed():
    breaker = AsyncCircuitBreaker("t7", fail_max=1, reset_timeout=60)
    with pytest.raises(RuntimeError):
        await breaker.call(_fail)
    assert breaker.state == BreakerState.OPEN

    await breaker.reset()
    assert breaker.state == BreakerState.CLOSED
    assert breaker.fail_count == 0


@pytest.mark.asyncio
async def test_call_async_breaker_helper():
    breaker = AsyncCircuitBreaker("t8", fail_max=2, reset_timeout=60)

    async def _echo(x: int) -> int:
        return x * 2

    assert await call_async_breaker(breaker, _echo, 3) == 6


@pytest.mark.asyncio
async def test_current_state_legacy_alias():
    """`current_state` string alias preserves the old pybreaker API shape."""
    breaker = AsyncCircuitBreaker("t9", fail_max=1, reset_timeout=60)
    assert breaker.current_state == "closed"
    with pytest.raises(RuntimeError):
        await breaker.call(_fail)
    assert breaker.current_state == "open"
