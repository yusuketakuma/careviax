'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildPresenceQueryKey, fetchPresenceUsers } from '@/lib/collaboration/presence-api-client';
import {
  mergePresenceUserUpdate,
  readPresenceUpdateEvent,
  type PresenceUser,
} from '@/lib/collaboration/presence-contract';
import { useOrgId } from './use-org-id';
import { useRealtimeQuery } from './use-realtime-query';

interface UsePresenceUsersOptions {
  entityType: string;
  entityId: string;
  enabled?: boolean;
}

const PRESENCE_REFETCH_INTERVAL_MS = 30_000;

export function usePresenceUsers({
  entityType,
  entityId,
  enabled = true,
}: UsePresenceUsersOptions) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const queryKey = buildPresenceQueryKey(entityType, entityId, orgId);
  const isEnabled = enabled && Boolean(orgId) && Boolean(entityId);
  const presenceTargets = useMemo(() => [{ entityType, entityId }], [entityType, entityId]);
  const patchPresenceFromRealtimeEvent = useCallback(
    (event: unknown) => {
      const updatedUser = readPresenceUpdateEvent(event, entityType, entityId);
      if (!updatedUser) return;

      queryClient.setQueryData<PresenceUser[]>(queryKey, (currentUsers = []) =>
        mergePresenceUserUpdate(currentUsers, updatedUser),
      );
    },
    [entityType, entityId, queryClient, queryKey],
  );

  const query = useRealtimeQuery<PresenceUser[]>({
    queryKey,
    queryFn: () => fetchPresenceUsers({ orgId, entityType, entityId }),
    enabled: isEnabled,
    invalidateOn: false,
    onRealtimeEvent: patchPresenceFromRealtimeEvent,
    fallbackRefetchInterval: PRESENCE_REFETCH_INTERVAL_MS,
    presenceTargets,
  });

  return {
    ...query,
    users: query.data ?? [],
    queryKey,
    enabled: isEnabled,
  };
}
