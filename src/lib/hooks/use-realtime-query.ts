'use client';

import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { useRealtimeInvalidation } from './use-realtime-invalidation';
import type { RealtimePresenceTarget } from '@/lib/realtime/shared-event-stream';

interface UseRealtimeQueryOptions<TData> extends Omit<
  UseQueryOptions<TData>,
  'queryKey' | 'queryFn'
> {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  invalidateOn?: readonly string[] | false;
  shouldInvalidate?: (event: unknown) => boolean;
  onRealtimeEvent?: (event: unknown) => void;
  fallbackRefetchInterval?: UseQueryOptions<TData>['refetchInterval'];
  pollWhenConnected?: boolean;
  presenceTargets?: RealtimePresenceTarget[];
}

export function useRealtimeQuery<TData>({
  queryKey,
  queryFn,
  invalidateOn = [],
  shouldInvalidate,
  onRealtimeEvent,
  fallbackRefetchInterval,
  pollWhenConnected = false,
  presenceTargets = [],
  ...options
}: UseRealtimeQueryOptions<TData>) {
  const { connected, receivesRealtimeUpdates } = useRealtimeInvalidation({
    queryKey,
    enabled: options.enabled !== false,
    invalidateOn,
    shouldInvalidate,
    onRealtimeEvent,
    presenceTargets,
  });

  const refetchInterval =
    fallbackRefetchInterval === undefined
      ? options.refetchInterval
      : connected && receivesRealtimeUpdates && !pollWhenConnected
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
