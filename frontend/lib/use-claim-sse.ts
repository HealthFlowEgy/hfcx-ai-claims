'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * SSE hook for real-time claim status updates (SRS FR-RT-001).
 *
 * Opens an EventSource connection to the backend SSE endpoint and
 * returns the most-recently received event payload.  Automatically
 * reconnects on error with exponential back-off.
 */

const SSE_URL =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8090') +
  '/internal/ai/sse/claims';

/** Maximum reconnection delay in ms. */
const MAX_RECONNECT_MS = 30_000;

export interface ClaimSSEEvent {
  [key: string]: unknown;
}

export function useClaimSSE() {
  const [event, setEvent] = useState<ClaimSSEEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const retryDelay = useRef(1_000);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      es = new EventSource(SSE_URL);

      es.onopen = () => {
        retryDelay.current = 1_000; // reset back-off on success
        setConnected(true);
      };

      es.onmessage = (msg) => {
        try {
          const parsed: ClaimSSEEvent = JSON.parse(msg.data);
          setEvent(parsed);
        } catch {
          // Ignore unparseable frames (e.g. heartbeat comments).
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;

        // Exponential back-off with jitter
        const jitter = Math.random() * 500;
        const delay = Math.min(retryDelay.current + jitter, MAX_RECONNECT_MS);
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_RECONNECT_MS);

        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      unmounted = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return { event, connected };
}
