'use client';

import {
  Bell,
  ClipboardList,
  HeartHandshake,
  MessagesSquare,
} from 'lucide-react';
import { DASHBOARD_COORDINATION_LINKS } from '@/lib/dashboard/home-config';
import { DashboardLinkGrid } from './dashboard-link-grid';

const COORDINATION_ICONS = {
  notifications: Bell,
  external: HeartHandshake,
  communications: MessagesSquare,
  handoff: ClipboardList,
} as const;

export function CoordinationNavigation() {
  return (
    <DashboardLinkGrid
      links={DASHBOARD_COORDINATION_LINKS}
      iconMap={COORDINATION_ICONS}
      compact
    />
  );
}
