'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRealtimeEvents } from './use-realtime-events';
import type { RealtimePresenceTarget } from '@/lib/realtime/shared-event-stream';

interface UseRealtimeInvalidationOptions {
  queryKey: QueryKey;
  enabled?: boolean;
  invalidateOn?: readonly string[] | false;
  shouldInvalidate?: (event: unknown) => boolean;
  onRealtimeEvent?: (event: unknown) => void;
  presenceTargets?: RealtimePresenceTarget[];
}

function readRealtimeEventType(event: unknown) {
  return typeof event === 'object' && event !== null && 'type' in event
    ? (event as { type: string }).type
    : undefined;
}

export function useRealtimeInvalidation({
  queryKey,
  enabled = true,
  invalidateOn = [],
  shouldInvalidate,
  onRealtimeEvent,
  presenceTargets = [],
}: UseRealtimeInvalidationOptions) {
  const queryClient = useQueryClient();
  const queryKeyHash = JSON.stringify(queryKey);
  const invalidateOnHash = JSON.stringify(invalidateOn);
  const presenceTargetsHash = JSON.stringify(presenceTargets);
  const shouldInvalidateQuery = invalidateOn !== false;
  const receivesRealtimeUpdates =
    shouldInvalidateQuery || shouldInvalidate !== undefined || onRealtimeEvent !== undefined;

  const realtimeQueryKey = useMemo(
    () => queryKey,
    // Preserve structural comparison for callers that build equivalent query keys per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKeyHash],
  );
  const realtimeInvalidateOn = useMemo(
    () => (invalidateOn === false ? [] : invalidateOn),
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

  const onEvent = useCallback(
    (event: unknown) => {
      if (shouldInvalidateQuery && shouldInvalidate) {
        if (shouldInvalidate(event)) {
          queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
        }
        onRealtimeEvent?.(event);
        return;
      }

      if (shouldInvalidateQuery && realtimeInvalidateOn.length === 0) {
        queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
        onRealtimeEvent?.(event);
        return;
      }

      const eventType = readRealtimeEventType(event);
      if (shouldInvalidateQuery && eventType && realtimeInvalidateOn.includes(eventType)) {
        queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
      }
      onRealtimeEvent?.(event);
    },
    [
      queryClient,
      realtimeQueryKey,
      realtimeInvalidateOn,
      shouldInvalidate,
      shouldInvalidateQuery,
      onRealtimeEvent,
    ],
  );

  const { connected } = useRealtimeEvents({
    onEvent,
    enabled,
    presenceTargets: realtimePresenceTargets,
  });

  return { connected, receivesRealtimeUpdates };
}
