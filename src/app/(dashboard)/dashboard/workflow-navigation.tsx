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
import { type DashboardFocusRole } from './dashboard-role-focus';

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

const ROLE_PRIMARY_WORKFLOW_KEYS: Record<DashboardFocusRole, readonly string[]> = {
  pharmacist: ['dispensing', 'auditing', 'visits', 'reports'],
  clerk: ['referrals', 'prescriptions', 'qr_drafts', 'schedules'],
  common: ['referrals', 'prescriptions', 'schedules', 'visits'],
};

const ROLE_PRIMARY_LABELS: Record<DashboardFocusRole, string> = {
  pharmacist: '薬剤師が最初に開く導線',
  clerk: '事務スタッフが最初に開く導線',
  common: '全員が最初に確認する導線',
};

const ROLE_SECONDARY_LABELS: Record<DashboardFocusRole, string> = {
  pharmacist: '続きの工程と支援フロー',
  clerk: '続きの受付・連携フロー',
  common: '続きの主要フロー',
};

function sortLinksByKeys(keys: readonly string[]) {
  const rank = new Map(keys.map((key, index) => [key, index]));

  return [...DASHBOARD_WORKFLOW_LINKS].sort((a, b) => {
    const aRank = rank.get(a.key);
    const bRank = rank.get(b.key);

    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}

export function WorkflowNavigation({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  const primaryKeys = ROLE_PRIMARY_WORKFLOW_KEYS[focusRole];
  const orderedLinks = sortLinksByKeys(primaryKeys);
  const primaryLinkSet = new Set(primaryKeys);
  const primaryLinks = orderedLinks.filter((link) => primaryLinkSet.has(link.key));
  const secondaryLinks = orderedLinks.filter((link) => !primaryLinkSet.has(link.key));

  return (
    <div className="space-y-4" data-testid="dashboard-phase-rail">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {ROLE_PRIMARY_LABELS[focusRole]}
        </p>
        <DashboardLinkGrid
          links={primaryLinks}
          iconMap={WORKFLOW_ICONS}
          className="xl:grid-cols-4"
          dataTestId={`dashboard-workflow-primary-${focusRole}`}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {ROLE_SECONDARY_LABELS[focusRole]}
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
