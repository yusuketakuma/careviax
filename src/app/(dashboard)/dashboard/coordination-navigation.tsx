'use client';

import {
  Bell,
  ClipboardList,
  HeartHandshake,
  MessagesSquare,
} from 'lucide-react';
import { DASHBOARD_COORDINATION_LINKS } from '@/lib/dashboard/home-config';
import { DashboardLinkGrid } from './dashboard-link-grid';
import { type DashboardFocusRole } from './dashboard-role-focus';

const COORDINATION_ICONS = {
  notifications: Bell,
  external: HeartHandshake,
  communications: MessagesSquare,
  handoff: ClipboardList,
} as const;

const ROLE_COORDINATION_KEYS: Record<DashboardFocusRole, readonly string[]> = {
  pharmacist: ['handoff', 'notifications', 'communications', 'external'],
  clerk: ['communications', 'notifications', 'handoff', 'external'],
  common: ['notifications', 'handoff', 'communications', 'external'],
};

function sortLinksByKeys(keys: readonly string[]) {
  const rank = new Map(keys.map((key, index) => [key, index]));

  return [...DASHBOARD_COORDINATION_LINKS].sort((a, b) => {
    const aRank = rank.get(a.key);
    const bRank = rank.get(b.key);

    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}

export function CoordinationNavigation({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  return (
    <DashboardLinkGrid
      links={sortLinksByKeys(ROLE_COORDINATION_KEYS[focusRole])}
      iconMap={COORDINATION_ICONS}
      compact
      dataTestId={`dashboard-coordination-${focusRole}`}
    />
  );
}
