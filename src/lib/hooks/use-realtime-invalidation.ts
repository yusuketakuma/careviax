'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { hashKey, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useRealtimeEvents } from './use-realtime-events';
import type { RealtimePresenceTarget } from '@/lib/realtime/shared-event-stream';
import type { RealtimeChannel } from '@/lib/realtime/readiness';

export type RealtimeInvalidationRule =
  | string
  | {
      type: string;
      source?: string | readonly string[];
    };

export type RealtimeInvalidationPolicy = readonly RealtimeInvalidationRule[] | 'all' | false;

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

function readRealtimeEventSource(event: unknown) {
  return typeof event === 'object' && event !== null && 'source' in event
    ? (event as { source: unknown }).source
    : undefined;
}

function matchesInvalidationRule(event: unknown, rule: RealtimeInvalidationRule): boolean {
  const eventType = readRealtimeEventType(event);
  if (!eventType) return false;
  if (typeof rule === 'string') return eventType === rule;
  if (eventType !== rule.type) return false;
  if (rule.source === undefined) return true;

  const eventSource = readRealtimeEventSource(event);
  if (typeof eventSource !== 'string') return false;
  return Array.isArray(rule.source)
    ? rule.source.includes(eventSource)
    : rule.source === eventSource;
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
  const pendingInvalidationsRef = useRef<Map<QueryClient, Map<string, QueryKey>>>(new Map());
  const queryKeyHash = hashKey(queryKey);
  const invalidateOnHash = JSON.stringify(invalidateOn);
  const presenceTargetsHash = JSON.stringify(presenceTargets);
  const shouldInvalidateQuery =
    invalidateOn === 'all' ||
    (Array.isArray(invalidateOn) && invalidateOn.length > 0) ||
    shouldInvalidate !== undefined;
  const invalidateAllEvents = invalidateOn === 'all';

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
  const requiredChannels = useMemo(() => {
    const channels: RealtimeChannel[] = [];
    if (shouldInvalidateQuery) channels.push('org');
    if (realtimePresenceTargets.length > 0) channels.push('presence');
    if (
      onRealtimeEvent !== undefined &&
      !shouldInvalidateQuery &&
      realtimePresenceTargets.length === 0
    ) {
      channels.push('user');
    }
    return channels;
  }, [onRealtimeEvent, realtimePresenceTargets, shouldInvalidateQuery]);
  const receivesRealtimeUpdates = requiredChannels.length > 0;

  const scheduleInvalidate = useCallback(() => {
    const pendingQueryKeys =
      pendingInvalidationsRef.current.get(queryClient) ?? new Map<string, QueryKey>();
    pendingQueryKeys.set(queryKeyHash, realtimeQueryKey);
    pendingInvalidationsRef.current.set(queryClient, pendingQueryKeys);

    if (invalidateTimerRef.current) return;

    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      const pendingInvalidations = [...pendingInvalidationsRef.current.entries()];
      pendingInvalidationsRef.current.clear();

      for (const [pendingQueryClient, queryKeys] of pendingInvalidations) {
        for (const pendingQueryKey of queryKeys.values()) {
          pendingQueryClient.invalidateQueries({ queryKey: pendingQueryKey });
        }
      }
    }, REALTIME_INVALIDATION_DEBOUNCE_MS);
  }, [queryClient, queryKeyHash, realtimeQueryKey]);

  useEffect(
    () => () => {
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
      }
      invalidateTimerRef.current = null;
      pendingInvalidationsRef.current.clear();
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

      if (
        shouldInvalidateQuery &&
        realtimeInvalidateOn.some((rule) => matchesInvalidationRule(event, rule))
      ) {
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
    requiredChannels,
  });

  const readinessHistoryRef = useRef({
    queryKeyHash,
    hasBeenReady: false,
    wasConnected: false,
  });
  useEffect(() => {
    let history = readinessHistoryRef.current;
    if (history.queryKeyHash !== queryKeyHash) {
      history = {
        queryKeyHash,
        hasBeenReady: false,
        wasConnected: false,
      };
      readinessHistoryRef.current = history;
    }

    if (!enabled || !receivesRealtimeUpdates) {
      history.hasBeenReady = false;
      history.wasConnected = false;
      return;
    }

    if (connected && history.hasBeenReady && !history.wasConnected) {
      void queryClient.refetchQueries({ queryKey: realtimeQueryKey, type: 'active' });
    }
    if (connected) history.hasBeenReady = true;
    history.wasConnected = connected;
  }, [connected, enabled, queryClient, queryKeyHash, realtimeQueryKey, receivesRealtimeUpdates]);

  return { connected, receivesRealtimeUpdates };
}
