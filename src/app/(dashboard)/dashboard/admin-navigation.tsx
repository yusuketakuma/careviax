'use client';

import { BarChart3, Cog, Database, Shield } from 'lucide-react';
import { DASHBOARD_ADMIN_LINKS } from '@/lib/dashboard/home-config';
import { DashboardLinkGrid } from './dashboard-link-grid';

const ADMIN_ICONS = {
  admin_dashboard: Shield,
  data_explorer: Database,
  jobs: Cog,
  metrics: BarChart3,
} as const;

export function AdminNavigation() {
  return (
    <DashboardLinkGrid
      links={DASHBOARD_ADMIN_LINKS}
      iconMap={ADMIN_ICONS}
      compact
    />
  );
}
