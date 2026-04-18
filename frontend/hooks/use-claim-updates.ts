'use client';

import { useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export interface ClaimUpdateEvent {
  event: string;
  claim_id: string;
  status: 'completed' | 'failed' | 'processing';
  decision?: string;
  confidence?: string;
  error?: string;
}

/**
 * Hook that subscribes to the SSE stream at /internal/ai/sse/claims
 * and invokes `onUpdate` whenever a claim status changes.
 *
 * Automatically reconnects on disconnect with exponential back-off.
 */
export function useClaimUpdates(
  onUpdate: (event: ClaimUpdateEvent) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    const url = `${API_BASE}/internal/ai/sse/claims`;
    const es = new EventSource(url);

    es.onopen = () => {
      // Reset back-off on successful connection
      reconnectDelay.current = 1000;
    };

    es.onmessage = (msg) => {
      try {
        const data: ClaimUpdateEvent = JSON.parse(msg.data);
        if (data.event === 'claim_update') {
          onUpdateRef.current(data);
        }
      } catch {
        // Ignore unparseable messages (heartbeats, etc.)
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect with exponential back-off (max 30s)
      const delay = Math.min(reconnectDelay.current, 30000);
      reconnectDelay.current = delay * 2;
      setTimeout(connect, delay);
    };

    return es;
  }, []);

  useEffect(() => {
    const es = connect();
    return () => es.close();
  }, [connect]);
}
