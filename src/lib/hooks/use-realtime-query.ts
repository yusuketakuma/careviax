'use client';

import { useCallback, useMemo } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useRealtimeEvents } from './use-realtime-events';

interface UseRealtimeQueryOptions<TData> extends Omit<
  UseQueryOptions<TData>,
  'queryKey' | 'queryFn'
> {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  invalidateOn?: string[];
  fallbackRefetchInterval?: UseQueryOptions<TData>['refetchInterval'];
  pollWhenConnected?: boolean;
}

export function useRealtimeQuery<TData>({
  queryKey,
  queryFn,
  invalidateOn = [],
  fallbackRefetchInterval,
  pollWhenConnected = false,
  ...options
}: UseRealtimeQueryOptions<TData>) {
  const queryClient = useQueryClient();
  const queryKeyHash = JSON.stringify(queryKey);
  const invalidateOnHash = JSON.stringify(invalidateOn);
  const realtimeQueryKey = useMemo(
    () => queryKey,
    // Preserve structural comparison for callers that build equivalent query keys per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKeyHash],
  );
  const realtimeInvalidateOn = useMemo(
    () => invalidateOn,
    // Preserve structural comparison for callers that build equivalent event lists per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invalidateOnHash],
  );

  const onEvent = useCallback(
    (event: unknown) => {
      if (realtimeInvalidateOn.length === 0) {
        queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
        return;
      }

      const eventType =
        typeof event === 'object' && event !== null && 'type' in event
          ? (event as { type: string }).type
          : undefined;

      if (eventType && realtimeInvalidateOn.includes(eventType)) {
        queryClient.invalidateQueries({ queryKey: realtimeQueryKey });
      }
    },
    [queryClient, realtimeQueryKey, realtimeInvalidateOn],
  );

  const { connected } = useRealtimeEvents({
    onEvent,
    enabled: options.enabled !== false,
  });

  const refetchInterval =
    fallbackRefetchInterval === undefined
      ? options.refetchInterval
      : connected && realtimeInvalidateOn.length > 0 && !pollWhenConnected
        ? false
        : fallbackRefetchInterval;

  const query = useQuery({
    queryKey,
    queryFn,
    ...options,
    refetchInterval,
  });

  return { ...query, connected };
}
