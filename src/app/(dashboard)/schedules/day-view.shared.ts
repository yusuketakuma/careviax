import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export type VisitPriority = 'normal' | 'urgent' | 'emergency';
export type VisitType =
  | 'initial'
  | 'regular'
  | 'temporary'
  | 'revisit'
  | 'delivery_only'
  | 'emergency'
  | 'physician_co_visit';
export type ProposalStatus =
  | 'proposed'
  | 'patient_contact_pending'
  | 'confirmed'
  | 'rejected'
  | 'superseded'
  | 'expired'
  | 'reschedule_pending';
export type PatientContactStatus =
  | 'pending'
  | 'attempted'
  | 'confirmed'
  | 'declined'
  | 'unreachable';
export type AssignmentMode = 'primary' | 'fallback';
export type ScheduleStatus =
  | 'planned'
  | 'in_preparation'
  | 'ready'
  | 'departed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'postponed'
  | 'rescheduled'
  | 'no_show';

export type CaseOption = {
  id: string;
  status: string;
  primary_pharmacist_id: string | null;
  primary_pharmacist_name: string | null;
  patient: {
    id: string;
    name: string;
    residences: Array<{
      address: string;
    }>;
  };
};

export type Pharmacist = {
  id: string;
  name: string;
  site_id: string | null;
  site_name: string | null;
};

export type ProposalContactLog = {
  id: string;
  outcome: PatientContactStatus;
  contact_name: string | null;
  contact_phone: string | null;
  note: string | null;
  callback_due_at: string | null;
  called_at: string;
  called_by: string;
};

export type Proposal = {
  id: string;
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  proposal_status: ProposalStatus;
  patient_contact_status: PatientContactStatus;
  proposed_date: string;
  time_window_start: string | null;
  time_window_end: string | null;
  proposed_pharmacist_id: string;
  proposed_pharmacist: {
    id: string;
    name: string;
    name_kana: string | null;
  } | null;
  assignment_mode: AssignmentMode;
  route_order: number | null;
  route_distance_score: number | null;
  medication_end_date: string | null;
  visit_deadline_date: string | null;
  proposal_reason: string;
  escalation_reason: string | null;
  finalized_schedule_id: string | null;
  reschedule_source_schedule_id: string | null;
  case_: {
    patient: {
      id: string;
      name: string;
      residences: Array<{
        address: string;
      }>;
    };
  };
  site: {
    id: string;
    name: string;
    address: string;
  } | null;
  finalized_schedule: {
    id: string;
    scheduled_date: string;
    pharmacist_id: string;
  } | null;
  reschedule_source_schedule: {
    id: string;
    scheduled_date: string;
    pharmacist_id: string;
    override_request: {
      status: 'pending' | 'completed' | 'cancelled';
      impact_summary: Record<string, unknown> | null;
    } | null;
  } | null;
  contact_logs: ProposalContactLog[];
};

export type AppliedOverride = {
  id: string;
  reason: string;
  requested_at: string;
  approved_at: string | null;
  source_schedule: {
    id: string;
    scheduled_date: string;
    time_window_start: string | null;
    time_window_end: string | null;
    pharmacist_id: string;
  };
};

export type PendingOverrideRequest = {
  id: string;
  status: 'pending' | 'completed' | 'cancelled';
  reason: string;
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  impact_summary: Record<string, unknown> | null;
};

export type VisitPreparation = {
  id: string;
  prepared_at: string | null;
  medication_changes_reviewed: boolean;
  carry_items_confirmed: boolean;
  previous_issues_reviewed: boolean;
  route_confirmed: boolean;
  offline_synced: boolean;
  checklist: Record<string, unknown>;
};

export type VisitPreparationPack = {
  patient: {
    id: string;
    name: string;
    address: string | null;
  };
  visit: {
    id: string;
    scheduled_date: string;
    time_window_start: string | null;
    time_window_end: string | null;
    schedule_status: ScheduleStatus;
    priority: VisitPriority;
    confirmed_at: string | null;
  };
  site: {
    id: string;
    name: string;
    address: string;
  } | null;
  handoff: {
    assignment_mode: AssignmentMode;
    summary: string;
  };
  readiness_blockers: string[];
  previous_visit: {
    id: string;
    visit_date: string;
    outcome_status: string;
    soap_plan: string | null;
    next_visit_suggestion_date: string | null;
  } | null;
  open_tasks: Array<{
    id: string;
    task_type: string;
    title: string;
    description: string | null;
    priority: ScheduleTaskPriority;
    due_at: string | null;
    action_href: string;
    action_label: string;
  }>;
  recent_contact_logs: Array<{
    id: string;
    outcome: PatientContactStatus;
    contact_name: string | null;
    contact_phone: string | null;
    note: string | null;
    callback_due_at: string | null;
    called_at: string;
    called_by: string;
  }>;
  facility_mode: {
    label: string | null;
    same_day_patient_count: number;
    same_day_patient_names: string[];
    route_orders: number[];
  };
  workload: {
    same_day_visit_count: number;
  };
  care_team: Array<{
    id: string;
    role: string;
    name: string;
    organization_name: string | null;
    phone: string | null;
  }>;
};

export type ScheduleTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ScheduleTaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type ScheduleTask = {
  id: string;
  task_type: string;
  title: string;
  description: string | null;
  status: ScheduleTaskStatus;
  priority: ScheduleTaskPriority;
  assigned_to: string | null;
  due_date: string | null;
  sla_due_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type VisitSchedule = {
  id: string;
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  schedule_status: ScheduleStatus;
  scheduled_date: string;
  time_window_start: string | null;
  time_window_end: string | null;
  pharmacist_id: string;
  assignment_mode: AssignmentMode;
  route_order: number | null;
  confirmed_at: string | null;
  case_: {
    patient: {
      id: string;
      name: string;
      residences: Array<{
        address: string;
      }>;
    };
  };
  site: {
    id: string;
    name: string;
    address: string;
  } | null;
  preparation: VisitPreparation | null;
  override_request: PendingOverrideRequest | null;
  applied_override: AppliedOverride | null;
  facility_hint: {
    label: string;
    patient_count: number;
    patient_names: string[];
  } | null;
  workload_hint: {
    daily_visit_count: number;
    urgent_visit_count: number;
  };
  handoff_hint: {
    summary: string;
  } | null;
};

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配達のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

export const PRIORITY_LABELS: Record<VisitPriority, string> = {
  normal: '通常',
  urgent: '至急',
  emergency: '緊急',
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  proposed: '提案中',
  patient_contact_pending: '架電待ち',
  confirmed: '確定済み',
  rejected: '却下',
  superseded: '差替済み',
  expired: '期限切れ',
  reschedule_pending: '再調整中',
};

export const CONTACT_STATUS_LABELS: Record<PatientContactStatus, string> = {
  pending: '未架電',
  attempted: '架電済み',
  confirmed: '患者確認済み',
  declined: '辞退',
  unreachable: '不通',
};

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  planned: '計画',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: '中止',
  postponed: '延期',
  rescheduled: '再調整',
  no_show: '不在',
};

export const PREPARATION_ITEMS = [
  ['medication_changes_reviewed', '薬歴・前回変更の確認'],
  ['carry_items_confirmed', '持参薬・物品確認'],
  ['previous_issues_reviewed', '前回課題の確認'],
  ['route_confirmed', 'ルート確認'],
  ['offline_synced', 'オフライン同期確認'],
] as const;

export const TASK_TYPE_LABELS: Record<string, string> = {
  visit_preparation: '訪問準備',
  visit_contact_followup: '架電フォロー',
  visit_schedule_override_approval: '変更承認',
  visit_demand: '訪問需要',
  visit_followup: '次回訪問',
  visit_intake_linkage: '処方受付導線',
};

export const SCHEDULING_TASK_TYPES = new Set(Object.keys(TASK_TYPE_LABELS));

export function toDateKey(value: string) {
  return value.slice(0, 10);
}

export function timeLabel(start: string | null, end: string | null) {
  const left = start ? format(parseISO(start), 'HH:mm') : '時間未定';
  const right = end ? format(parseISO(end), 'HH:mm') : null;
  return right ? `${left} - ${right}` : left;
}

export function addressOfPatient(item: {
  case_: {
    patient: {
      residences: Array<{
        address: string;
      }>;
    };
  };
}) {
  return item.case_.patient.residences[0]?.address ?? '住所未登録';
}

export function countCompletedPreparationItems(preparation: VisitPreparation | null) {
  if (!preparation) return 0;
  return PREPARATION_ITEMS.filter(([field]) => preparation[field]).length;
}

export function taskPriorityClass(priority: ScheduleTaskPriority) {
  switch (priority) {
    case 'urgent':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'high':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'low':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
}

export function formatTaskDueLabel(task: ScheduleTask) {
  const value = task.sla_due_at ?? task.due_date;
  if (!value) return '期限未設定';
  return format(parseISO(value), 'M/d HH:mm', { locale: ja });
}

export function statusBadgeClass(status: ProposalStatus | ScheduleStatus) {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'patient_contact_pending':
    case 'ready':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'reschedule_pending':
    case 'rescheduled':
    case 'postponed':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'rejected':
    case 'cancelled':
    case 'no_show':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

export function splitProposalReason(reason: string | null | undefined) {
  if (!reason) return [];
  return reason
    .split(' / ')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readImpactCount(impactSummary: Record<string, unknown> | null | undefined) {
  if (!impactSummary) return null;
  const value = impactSummary.impacted_schedule_count;
  return typeof value === 'number' ? value : null;
}

export function priorityBadgeClass(priority: VisitPriority) {
  switch (priority) {
    case 'emergency':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'urgent':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}
