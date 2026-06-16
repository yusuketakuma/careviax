'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { subscribeSharedRealtimeStream } from '@/lib/realtime/shared-event-stream';
import { useOrgId } from './use-org-id';

interface UseRealtimeEventsOptions {
  onEvent: (event: unknown) => void;
  enabled?: boolean;
}

const NOTIFICATION_STREAM_DISABLED = process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';

export function useRealtimeEvents({ onEvent, enabled = true }: UseRealtimeEventsOptions) {
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
    });
  }, [enabled, orgId]);

  return {
    connected:
      enabled &&
      !NOTIFICATION_STREAM_DISABLED &&
      connectionState.orgId === orgId &&
      connectionState.connected,
  };
}
