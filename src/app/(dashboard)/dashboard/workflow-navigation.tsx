'use client';

import {
  CalendarDays,
  ClipboardCheck,
  ClipboardPlus,
  FilePlus,
  FileText,
  Package,
  Pill,
  QrCode,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { DASHBOARD_WORKFLOW_LINKS } from '@/lib/dashboard/home-config';
import { DashboardLinkGrid } from './dashboard-link-grid';

const WORKFLOW_ICONS = {
  referrals: ClipboardPlus,
  prescriptions: FilePlus,
  qr_drafts: QrCode,
  qr_scan: QrCode,
  dispensing: Pill,
  auditing: ShieldCheck,
  medication_sets: Package,
  schedules: CalendarDays,
  visits: ClipboardCheck,
  reports: FileText,
  conferences: Users,
} as const;

const PRIMARY_WORKFLOW_KEYS = new Set(['referrals', 'prescriptions', 'schedules']);

export function WorkflowNavigation() {
  const primaryLinks = DASHBOARD_WORKFLOW_LINKS.filter((link) => PRIMARY_WORKFLOW_KEYS.has(link.key));
  const secondaryLinks = DASHBOARD_WORKFLOW_LINKS.filter((link) => !PRIMARY_WORKFLOW_KEYS.has(link.key));

  return (
    <div className="space-y-4" data-testid="dashboard-phase-rail">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          最初に始める 3 操作
        </p>
        <DashboardLinkGrid
          links={primaryLinks}
          iconMap={WORKFLOW_ICONS}
          className="xl:grid-cols-3"
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          続きの主要フロー
        </p>
        <DashboardLinkGrid
          links={secondaryLinks}
          iconMap={WORKFLOW_ICONS}
          compact
          className="xl:grid-cols-4"
        />
      </div>
    </div>
  );
}
