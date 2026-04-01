'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useOrgId } from './use-org-id';

interface UseRealtimeEventsOptions {
  onEvent: (event: unknown) => void;
  enabled?: boolean;
}

export function useRealtimeEvents({ onEvent, enabled = true }: UseRealtimeEventsOptions) {
  const orgId = useOrgId();
  const [connected, setConnected] = useState(false);
  const handleEvent = useEffectEvent(onEvent);

  const reconnectAttemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!enabled || !orgId) {
      cleanup();
      return;
    }

    let unmounted = false;

    async function connect() {
      if (unmounted) return;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/notifications/stream', {
          headers: { 'x-org-id': orgId },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error('Failed to open realtime stream');
        }

        if (unmounted) return;
        setConnected(true);
        reconnectAttemptRef.current = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!unmounted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.startsWith('data: ')) continue;
            try {
              handleEvent(JSON.parse(chunk.slice(6)));
            } catch {
              // Ignore malformed messages
            }
          }
        }
      } catch {
        if (unmounted) return;
        setConnected(false);

        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current = attempt + 1;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);

        timerRef.current = setTimeout(connect, delay);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }

    void connect();

    return () => {
      unmounted = true;
      cleanup();
    };
  }, [enabled, cleanup, handleEvent, orgId]);

  return { connected: enabled && connected };
}
