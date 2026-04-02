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

const WORKBENCH_ICONS = {
  my_day: Clock3,
  workflow: ListChecks,
  tasks: CheckSquare,
  billing: ScrollText,
  billing_candidates: Receipt,
  schedule_proposals: CalendarClock,
} as const;

export function WorkbenchNavigation() {
  return (
    <DashboardLinkGrid
      links={DASHBOARD_WORKBENCH_LINKS}
      iconMap={WORKBENCH_ICONS}
      compact
    />
  );
}
