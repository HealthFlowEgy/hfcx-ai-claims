"""
SSE endpoint for real-time claim status updates.
SRS FR-RT-001: Payer Claims Queue receives live updates via SSE.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

import structlog
from fastapi import APIRouter
from starlette.responses import StreamingResponse

from src.services.redis_service import get_redis_pool

log = structlog.get_logger(__name__)
router = APIRouter()

CLAIM_UPDATES_CHANNEL = "hfcx:claim:updates"
HEARTBEAT_INTERVAL_SECONDS = 15


async def _claim_event_generator() -> AsyncGenerator[str, None]:
    """
    Yield SSE-formatted events from the Redis pub/sub channel
    ``hfcx:claim:updates``.  A heartbeat comment is sent every 15 s
    to keep proxies / load-balancers from closing the connection.
    """
    import redis.asyncio as aioredis

    client = aioredis.Redis(connection_pool=get_redis_pool())
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(CLAIM_UPDATES_CHANNEL)
        log.info("sse_subscribed", channel=CLAIM_UPDATES_CHANNEL)

        while True:
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    ),
                    timeout=HEARTBEAT_INTERVAL_SECONDS,
                )
            except TimeoutError:
                # No message within heartbeat window — send keep-alive.
                yield ": heartbeat\n\n"
                continue

            if message is not None and message["type"] == "message":
                data = message["data"]
                # Ensure the payload is valid JSON text.
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                try:
                    # Validate that data is parseable JSON.
                    json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    data = json.dumps({"raw": data})

                yield f"data: {data}\n\n"
    except asyncio.CancelledError:
        log.info("sse_client_disconnected", channel=CLAIM_UPDATES_CHANNEL)
    finally:
        await pubsub.unsubscribe(CLAIM_UPDATES_CHANNEL)
        await pubsub.close()
        await client.close()


@router.get("/sse/claims")
async def stream_claim_updates() -> StreamingResponse:
    """
    SSE stream of real-time claim status updates.

    The client opens a persistent ``GET`` connection and receives
    ``data: {json}\\n\\n`` frames whenever a claim status changes.
    A heartbeat comment (``:``) is emitted every 15 s.
    """
    return StreamingResponse(
        _claim_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
