'use client';

import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

/** Colors assigned to remote users based on a hash of their user ID. */
const CURSOR_COLORS = [
  { badgeClass: 'bg-blue-500' },
  { badgeClass: 'bg-emerald-500' },
  { badgeClass: 'bg-violet-500' },
  { badgeClass: 'bg-amber-500' },
  { badgeClass: 'bg-rose-500' },
  { badgeClass: 'bg-cyan-500' },
  { badgeClass: 'bg-fuchsia-500' },
  { badgeClass: 'bg-lime-500' },
];

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getCursorColor(userId: string) {
  return CURSOR_COLORS[hashUserId(userId) % CURSOR_COLORS.length]!;
}

interface RemoteCursor {
  clientId: number;
  userId: string;
  displayName: string;
  color: (typeof CURSOR_COLORS)[number];
}

interface CursorOverlayProps {
  awareness: Awareness;
}

/**
 * Renders colored labels for remote collaborators using Yjs Awareness data.
 * Displayed as small name badges to indicate who else is editing.
 *
 * Cursor position rendering in the textarea is intentionally simplified --
 * exact character-position overlays require a code-editor (Monaco/CodeMirror).
 * This component shows presence indicators instead.
 */
export function CursorOverlay({ awareness }: CursorOverlayProps) {
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  useEffect(() => {
    const updateCursors = () => {
      const localClientId = awareness.clientID;
      const cursors: RemoteCursor[] = [];

      awareness.getStates().forEach((state, clientId) => {
        if (clientId === localClientId) return;
        const user = state.user as
          | { userId?: string; displayName?: string }
          | undefined;
        if (!user?.userId) return;

        cursors.push({
          clientId,
          userId: user.userId,
          displayName: user.displayName ?? 'User',
          color: getCursorColor(user.userId),
        });
      });

      setRemoteCursors(cursors);
    };

    updateCursors();
    awareness.on('change', updateCursors);
    return () => awareness.off('change', updateCursors);
  }, [awareness]);

  if (remoteCursors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute -top-5 right-0 flex gap-1">
      {remoteCursors.map((cursor) => (
        <span
          key={cursor.clientId}
          className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium leading-none text-white ${cursor.color.badgeClass}`}
        >
          {cursor.displayName}
        </span>
      ))}
    </div>
  );
}
