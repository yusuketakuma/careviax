'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useOrgId } from './use-org-id';

interface UseRealtimeEventsOptions {
  onEvent: (event: unknown) => void;
  enabled?: boolean;
}

const NOTIFICATION_STREAM_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';

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
  }, []);

  useEffect(() => {
    if (!enabled || !orgId || NOTIFICATION_STREAM_DISABLED) {
      cleanup();
      setConnected(false);
      return;
    }

    let unmounted = false;
    setConnected(false);

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

        // Stream closed normally (e.g. server-side 5-minute timeout).
        // Reconnect immediately with a clean backoff counter.
        if (!unmounted) {
          setConnected(false);
          reconnectAttemptRef.current = 0;
          timerRef.current = setTimeout(connect, 1_000);
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
  }, [enabled, cleanup, orgId]);

  return { connected: enabled && connected };
}
