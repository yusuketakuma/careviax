'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRealtimeEvents } from './use-realtime-events';
import type { RealtimePresenceTarget } from '@/lib/realtime/shared-event-stream';

export type RealtimeInvalidationPolicy = readonly string[] | 'all' | false;

interface UseRealtimeInvalidationOptions {
  queryKey: QueryKey;
  enabled?: boolean;
  invalidateOn?: RealtimeInvalidationPolicy;
  shouldInvalidate?: (event: unknown) => boolean;
  onRealtimeEvent?: (event: unknown) => void;
  presenceTargets?: RealtimePresenceTarget[];
}

const REALTIME_INVALIDATION_DEBOUNCE_MS = 150;

function readRealtimeEventType(event: unknown) {
  return typeof event === 'object' && event !== null && 'type' in event
    ? (event as { type: string }).type
    : undefined;
}

export function useRealtimeInvalidation({
  queryKey,
  enabled = true,
  invalidateOn = false,
  shouldInvalidate,
  onRealtimeEvent,
  presenceTargets = [],
}: UseRealtimeInvalidationOptions) {
  const queryClient = useQueryClient();
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryKeyHash = JSON.stringify(queryKey);
  const invalidateOnHash = JSON.stringify(invalidateOn);
  const presenceTargetsHash = JSON.stringify(presenceTargets);
  const shouldInvalidateQuery =
    invalidateOn === 'all' ||
    (Array.isArray(invalidateOn) && invalidateOn.length > 0) ||
    shouldInvalidate !== undefined;
  const invalidateAllEvents = invalidateOn === 'all';
  const receivesRealtimeUpdates =
    shouldInvalidateQuery || onRealtimeEvent !== undefined || presenceTargets.length > 0;

  const realtimeQueryKey = useMemo(
    () => queryKey,
    // Preserve structural comparison for callers that build equivalent query keys per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKeyHash],
  );
  const realtimeInvalidateOn = useMemo(
    () => (Array.isArray(invalidateOn) ? invalidateOn : []),
    // Preserve structural comparison for callers that build equivalent event lists per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invalidateOnHash],
  );
  const realtimePresenceTargets = useMemo(
    () => presenceTargets,
    // Preserve structural comparison for callers that build equivalent presence targets per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presenceTargetsHash],
  );

  const scheduleInvalidate = useCallback(() => {
    if (invalidateTimerRef.current) return;

    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
    }, REALTIME_INVALIDATION_DEBOUNCE_MS);
  }, [queryClient, realtimeQueryKey]);

  useEffect(
    () => () => {
      if (!invalidateTimerRef.current) return;
      clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = null;
    },
    [],
  );

  const onEvent = useCallback(
    (event: unknown) => {
      if (shouldInvalidateQuery && shouldInvalidate) {
        if (shouldInvalidate(event)) {
          scheduleInvalidate();
        }
        onRealtimeEvent?.(event);
        return;
      }

      if (shouldInvalidateQuery && invalidateAllEvents) {
        scheduleInvalidate();
        onRealtimeEvent?.(event);
        return;
      }

      const eventType = readRealtimeEventType(event);
      if (shouldInvalidateQuery && eventType && realtimeInvalidateOn.includes(eventType)) {
        scheduleInvalidate();
      }
      onRealtimeEvent?.(event);
    },
    [
      invalidateAllEvents,
      realtimeInvalidateOn,
      scheduleInvalidate,
      shouldInvalidate,
      shouldInvalidateQuery,
      onRealtimeEvent,
    ],
  );

  const { connected } = useRealtimeEvents({
    onEvent,
    enabled: enabled && receivesRealtimeUpdates,
    presenceTargets: realtimePresenceTargets,
  });

  return { connected, receivesRealtimeUpdates };
}
