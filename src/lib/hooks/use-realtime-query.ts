'use client';

import { useCallback } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useRealtimeEvents } from './use-realtime-events';

interface UseRealtimeQueryOptions<TData>
  extends Omit<UseQueryOptions<TData>, 'queryKey' | 'queryFn'> {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  invalidateOn?: string[];
}

export function useRealtimeQuery<TData>({
  queryKey,
  queryFn,
  invalidateOn = [],
  ...options
}: UseRealtimeQueryOptions<TData>) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(
    (event: unknown) => {
      if (invalidateOn.length === 0) {
        queryClient.invalidateQueries({ queryKey });
        return;
      }

      const eventType =
        typeof event === 'object' && event !== null && 'type' in event
          ? (event as { type: string }).type
          : undefined;

      if (eventType && invalidateOn.includes(eventType)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, JSON.stringify(queryKey), JSON.stringify(invalidateOn)]
  );

  const { connected } = useRealtimeEvents({ onEvent });

  const query = useQuery({
    queryKey,
    queryFn,
    ...options,
  });

  return { ...query, connected };
}
