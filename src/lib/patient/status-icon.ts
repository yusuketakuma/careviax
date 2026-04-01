import type { PatientStatusIcon } from '@/types/dashboard-home';

/**
 * Derive a patient status icon from risk/operational data.
 * Shared between dashboard patient cards and patient detail pages.
 */
export function derivePatientStatusIcon(p: {
  score: number;
  level: string;
  open_tasks: number;
  pending_reports: number;
  hasCompletedVisit: boolean;
  hasNextVisit: boolean;
  hasOverdueVisit: boolean;
  hasRecentMedChange: boolean;
  hasUnresolvedSelfReports: boolean;
  caseStatus: string | null;
  exceptionStatus: string | null;
}): PatientStatusIcon {
  if (p.caseStatus === 'on_hold') return 'paused';
  if (p.exceptionStatus === 'hospitalized') return 'hospitalized';
  if (p.exceptionStatus === 'discharged') return 'discharged';
  if (p.exceptionStatus === 'no_contact' || p.exceptionStatus === 'awaiting_reply') return 'no_contact';
  if (p.level === 'high' || p.score >= 7) return 'urgent';
  if (p.hasOverdueVisit) return 'overdue_visit';
  if (p.pending_reports > 0) return 'report_pending';
  if (p.hasRecentMedChange) return 'medication_change';
  if (!p.hasCompletedVisit && p.hasNextVisit) return 'first_visit_soon';
  if (!p.hasCompletedVisit) return 'new';
  if (p.level === 'watch' || p.open_tasks > 0 || p.hasUnresolvedSelfReports) return 'attention';
  return 'stable';
}

/** Status icon display config for UI components */
export const STATUS_ICON_CONFIG: Record<
  PatientStatusIcon,
  { label: string; color: string; bg: string }
> = {
  stable: { label: '安定', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
  new: { label: '新規', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  first_visit_soon: { label: '初回予定', color: 'text-sky-600', bg: 'bg-sky-50 border-sky-200' },
  attention: { label: '要確認', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' },
  urgent: { label: '要対応', color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
  overdue_visit: { label: '訪問遅延', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
  report_pending: { label: '報告未提出', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  medication_change: { label: '処方変更', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200' },
  hospitalized: { label: '入院中', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
  discharged: { label: '退院直後', color: 'text-teal-600', bg: 'bg-teal-50 border-teal-200' },
  no_contact: { label: '連絡不通', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
  paused: { label: '休止中', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
};

/** Lucide icon name mapping (use dynamic import or switch in components) */
export const STATUS_ICON_NAME: Record<PatientStatusIcon, string> = {
  stable: 'UserCheck',
  new: 'Sparkles',
  first_visit_soon: 'CalendarPlus',
  attention: 'Star',
  urgent: 'TriangleAlert',
  overdue_visit: 'Clock',
  report_pending: 'FileWarning',
  medication_change: 'RefreshCw',
  hospitalized: 'Hospital',
  discharged: 'LogOut',
  no_contact: 'PhoneOff',
  paused: 'CirclePause',
};
