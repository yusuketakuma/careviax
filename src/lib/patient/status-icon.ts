import type { PatientStatusIcon } from '@/types/dashboard-home';
import { PATIENT_STATUS_ICON_ROLE, type StatusRoleOrNeutral } from '@/lib/constants/status-labels';

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
  if (p.exceptionStatus === 'no_contact' || p.exceptionStatus === 'awaiting_reply')
    return 'no_contact';
  if (p.level === 'high' || p.score >= 7) return 'urgent';
  if (p.hasOverdueVisit) return 'overdue_visit';
  if (p.pending_reports > 0) return 'report_pending';
  if (p.hasRecentMedChange) return 'medication_change';
  if (!p.hasCompletedVisit && p.hasNextVisit) return 'first_visit_soon';
  if (!p.hasCompletedVisit) return 'new';
  if (p.level === 'watch' || p.open_tasks > 0 || p.hasUnresolvedSelfReports) return 'attention';
  return 'stable';
}

/**
 * 6軸ロール → アイコンチップ/バッジ配色(SSOT 3.1)。中央トークン(`--state-*`/`--tag-*`)
 * のみを参照し、raw Tailwind パレット(green-600 等)をベタ書きしない。
 * 写像の正本は `PATIENT_STATUS_ICON_ROLE`(status-labels.ts)と SSOT 確定表。
 */
const ROLE_CHIP_CLASSES: Record<StatusRoleOrNeutral, { color: string; bg: string }> = {
  info: { color: 'text-tag-info', bg: 'bg-tag-info/10 border-tag-info/30' },
  hazard: { color: 'text-tag-hazard', bg: 'bg-tag-hazard/10 border-tag-hazard/30' },
  blocked: { color: 'text-state-blocked', bg: 'bg-state-blocked/10 border-state-blocked/30' },
  done: { color: 'text-state-done', bg: 'bg-state-done/10 border-state-done/30' },
  confirm: { color: 'text-state-confirm', bg: 'bg-state-confirm/10 border-state-confirm/30' },
  waiting: { color: 'text-state-waiting', bg: 'bg-state-waiting/10 border-state-waiting/30' },
  readonly: { color: 'text-state-readonly', bg: 'bg-state-readonly/10 border-state-readonly/30' },
  neutral: { color: 'text-muted-foreground', bg: 'bg-muted border-border/70' },
};

function chipClasses(icon: PatientStatusIcon) {
  // PATIENT_STATUS_ICON_ROLE は Record<PatientStatusIcon, …> を satisfies で網羅保証して
  // いるため fallback を置かない(enum 追加時は typecheck で検出させる)。
  return ROLE_CHIP_CLASSES[PATIENT_STATUS_ICON_ROLE[icon]];
}

/** Status icon display config for UI components */
export const STATUS_ICON_CONFIG: Record<
  PatientStatusIcon,
  { label: string; color: string; bg: string }
> = {
  stable: { label: '安定', ...chipClasses('stable') },
  new: { label: '新規', ...chipClasses('new') },
  first_visit_soon: { label: '初回予定', ...chipClasses('first_visit_soon') },
  attention: { label: '要確認', ...chipClasses('attention') },
  urgent: { label: '要対応', ...chipClasses('urgent') },
  overdue_visit: { label: '訪問遅延', ...chipClasses('overdue_visit') },
  report_pending: { label: '報告未提出', ...chipClasses('report_pending') },
  medication_change: { label: '処方変更', ...chipClasses('medication_change') },
  hospitalized: { label: '入院中', ...chipClasses('hospitalized') },
  discharged: { label: '退院直後', ...chipClasses('discharged') },
  no_contact: { label: '連絡不通', ...chipClasses('no_contact') },
  paused: { label: '休止中', ...chipClasses('paused') },
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
