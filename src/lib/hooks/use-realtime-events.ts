'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import {
  subscribeSharedRealtimeStream,
  type RealtimePresenceTarget,
} from '@/lib/realtime/shared-event-stream';
import { useOrgId } from './use-org-id';

interface UseRealtimeEventsOptions {
  onEvent: (event: unknown) => void;
  enabled?: boolean;
  presenceTargets?: RealtimePresenceTarget[];
}

const NOTIFICATION_STREAM_DISABLED = process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';
const EMPTY_PRESENCE_TARGETS: RealtimePresenceTarget[] = [];

export function useRealtimeEvents({
  onEvent,
  enabled = true,
  presenceTargets = EMPTY_PRESENCE_TARGETS,
}: UseRealtimeEventsOptions) {
  const orgId = useOrgId();
  const [connectionState, setConnectionState] = useState<{
    orgId: string | null;
    connected: boolean;
  }>({ orgId: null, connected: false });
  const handleEvent = useEffectEvent(onEvent);

  useEffect(() => {
    if (!enabled || !orgId || NOTIFICATION_STREAM_DISABLED) {
      return;
    }

    return subscribeSharedRealtimeStream({
      orgId,
      onEvent: (event) => handleEvent(event),
      onStatus: (connected) => setConnectionState({ orgId, connected }),
      presenceTargets,
    });
  }, [enabled, orgId, presenceTargets]);

  return {
    connected:
      enabled &&
      !NOTIFICATION_STREAM_DISABLED &&
      connectionState.orgId === orgId &&
      connectionState.connected,
  };
}
