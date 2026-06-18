'use client';

import {
  getCollaboratorColorClass,
  type PresenceUser,
} from '@/lib/collaboration/presence-contract';

interface FieldLockIndicatorProps {
  fieldName: string;
  presenceData: PresenceUser[];
}

export function FieldLockIndicator({ fieldName, presenceData }: FieldLockIndicatorProps) {
  const user = presenceData.find((u) => u.active_field === fieldName);
  if (!user) return null;

  const colorClass = getCollaboratorColorClass(user.user_id);

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={`inline-block size-2 rounded-full ${colorClass}`} aria-hidden="true" />
      <span>{user.display_name} が編集中</span>
    </span>
  );
}
