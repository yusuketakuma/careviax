'use client';

import type { PresenceUser } from './presence-avatars';

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

interface FieldLockIndicatorProps {
  fieldName: string;
  presenceData: PresenceUser[];
}

export function FieldLockIndicator({ fieldName, presenceData }: FieldLockIndicatorProps) {
  const user = presenceData.find((u) => u.active_field === fieldName);
  if (!user) return null;

  const colorClass = avatarColor(user.user_id);

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={`inline-block size-2 rounded-full ${colorClass}`} aria-hidden="true" />
      <span>{user.display_name} が編集中</span>
    </span>
  );
}
