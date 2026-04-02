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

export function WorkflowNavigation() {
  return <DashboardLinkGrid links={DASHBOARD_WORKFLOW_LINKS} iconMap={WORKFLOW_ICONS} />;
}
