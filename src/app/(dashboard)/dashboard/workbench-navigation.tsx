'use client';

import {
  CalendarClock,
  CheckSquare,
  Clock3,
  ListChecks,
  Receipt,
  ScrollText,
} from 'lucide-react';
import { DASHBOARD_WORKBENCH_LINKS } from '@/lib/dashboard/home-config';
import { DashboardLinkGrid } from './dashboard-link-grid';
import { type DashboardFocusRole } from './dashboard-role-focus';

const WORKBENCH_ICONS = {
  my_day: Clock3,
  workflow: ListChecks,
  tasks: CheckSquare,
  billing: ScrollText,
  billing_candidates: Receipt,
  schedule_proposals: CalendarClock,
} as const;

const ROLE_WORKBENCH_KEYS: Record<DashboardFocusRole, readonly string[]> = {
  pharmacist: ['my_day', 'tasks', 'workflow', 'billing', 'billing_candidates', 'schedule_proposals'],
  clerk: ['schedule_proposals', 'tasks', 'my_day', 'workflow', 'billing_candidates', 'billing'],
  common: ['my_day', 'tasks', 'workflow', 'schedule_proposals', 'billing_candidates', 'billing'],
};

function sortLinksByKeys(keys: readonly string[]) {
  const rank = new Map(keys.map((key, index) => [key, index]));

  return [...DASHBOARD_WORKBENCH_LINKS].sort((a, b) => {
    const aRank = rank.get(a.key);
    const bRank = rank.get(b.key);

    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}

export function WorkbenchNavigation({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  return (
    <DashboardLinkGrid
      links={sortLinksByKeys(ROLE_WORKBENCH_KEYS[focusRole])}
      iconMap={WORKBENCH_ICONS}
      compact
      dataTestId={`dashboard-workbench-${focusRole}`}
    />
  );
}
