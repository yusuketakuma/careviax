'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeEvents } from '@/lib/hooks/use-realtime-events';
import { useOrgId } from '@/lib/hooks/use-org-id';

export interface PresenceUser {
  user_id: string;
  display_name: string;
  active_field: string | null;
  updated_at: string;
}

interface PresenceAvatarsProps {
  entityType: string;
  entityId: string;
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
];

function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_VISIBLE = 5;

export function PresenceAvatars({ entityType, entityId }: PresenceAvatarsProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const queryKey = ['presence', entityType, entityId, orgId];

  const { data: allUsers = [] } = useQuery<PresenceUser[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/presence?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) return [];
      const json = await res.json() as { data: PresenceUser[] };
      return json.data ?? [];
    },
    refetchInterval: 5000,
    enabled: !!orgId && !!entityId,
  });

  // Listen for SSE presence_update events to invalidate query instantly
  useRealtimeEvents({
    onEvent: (event) => {
      const e = event as { type?: string; entity_type?: string; entity_id?: string };
      if (
        e.type === 'presence_update' &&
        e.entity_type === entityType &&
        e.entity_id === entityId
      ) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  // Heartbeat: POST on mount and every 30s
  useEffect(() => {
    if (!orgId || !entityId) return;

    const postPresence = () => {
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, active_field: null }),
      }).catch(() => {
        // Ignore errors — presence is best-effort
      });
    };

    postPresence();
    heartbeatRef.current = setInterval(postPresence, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [orgId, entityType, entityId]);

  if (allUsers.length === 0) return null;

  const visible = allUsers.slice(0, MAX_VISIBLE);
  const overflow = allUsers.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-1" aria-label="現在閲覧中のユーザー">
      {visible.map((user) => (
        <span
          key={user.user_id}
          title={user.display_name}
          className={`flex size-7 shrink-0 cursor-default items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background ${avatarColor(user.user_id)}`}
          aria-label={user.display_name}
        >
          {user.display_name.charAt(0)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-background">
          +{overflow}
        </span>
      )}
    </div>
  );
}
