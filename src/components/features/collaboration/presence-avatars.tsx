'use client';

import { usePresenceHeartbeat } from '@/lib/hooks/use-presence-heartbeat';
import { usePresenceUsers } from '@/lib/hooks/use-presence-users';
import { getCollaboratorColorClass } from '@/lib/collaboration/presence-contract';

interface PresenceAvatarsProps {
  entityType: string;
  entityId: string;
}

const MAX_VISIBLE = 5;

export function PresenceAvatars({ entityType, entityId }: PresenceAvatarsProps) {
  const { users: allUsers, enabled } = usePresenceUsers({ entityType, entityId });

  usePresenceHeartbeat({
    entityType,
    entityId,
    enabled,
  });

  if (allUsers.length === 0) return null;

  const visible = allUsers.slice(0, MAX_VISIBLE);
  const overflow = allUsers.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-1" aria-label="現在閲覧中のユーザー">
      {visible.map((user) => (
        <span
          key={user.user_id}
          title={user.display_name}
          className={`flex size-7 shrink-0 cursor-default items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background ${getCollaboratorColorClass(user.user_id)}`}
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
