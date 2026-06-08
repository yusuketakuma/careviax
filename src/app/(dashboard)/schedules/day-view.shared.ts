import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { HomeVisit2026BillingBlocker } from '@/lib/visits/home-visit-2026-evidence';
import type { HomeCareFeatureState } from '@/types/home-care';
import type { VisitBrief } from '@/types/visit-brief';

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
  | 'change_requested'
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
      lat?: number | null;
      lng?: number | null;
    }>;
  };
};

export type Pharmacist = {
  id: string;
  name: string;
  site_id: string | null;
  site_name: string | null;
};

export type VisitVehicleResourceSummary = {
  id: string;
  label: string;
  travel_mode: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
  max_stops: number | null;
  max_route_duration_minutes: number | null;
};

export type ProposalContactLog = {
  id: string;
  outcome: PatientContactStatus;
  contact_method: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  note: string | null;
  callback_due_at: string | null;
  called_at: string;
  called_by: string;
};

export type BillingRequirementAlert = {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details: Record<string, unknown>;
  as_of: string;
};

export type BillingCadencePreview = {
  monthly_cap: number;
  current_month_count: number;
  remaining_month_count: number;
  weekly_cap: number | null;
  current_week_count: number;
  scheduled_dates_current_month: string[];
  next_billable_date: string | null;
  suggested_dates: string[];
  reason: string;
};
export type SiteConfigStatus =
  | 'not_required'
  | 'site_unassigned'
  | 'config_missing'
  | 'revision_mismatch'
  | 'resolved';

export type HomeComprehensivePreview = {
  level: string | null;
  ssotKey: string | null;
  code: string | null;
  name: string | null;
  points: number | null;
  buildingTier: 'single' | 'other' | null;
};

export type VisitScheduleBillingPreview = {
  alerts: BillingRequirementAlert[];
  cadence: BillingCadencePreview;
  recommended_visit_type: VisitType;
  recommended_priority: VisitPriority;
  suggested_schedule_slot_count: number;
  effective_revision_code: string;
  effective_revision_label: string;
  site_config_status: SiteConfigStatus;
  site_config_revision_code: string | null;
  warnings: string[];
  home_comprehensive_preview: HomeComprehensivePreview | null;
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
        building_id?: string | null;
        unit_name?: string | null;
        lat?: number | null;
        lng?: number | null;
      }>;
    };
  };
  site: {
    id: string;
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
  } | null;
  vehicle_resource?: VisitVehicleResourceSummary | null;
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
    visit_type: VisitType;
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
    summary?: string | null;
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
  facility_parallel_context: {
    batch_id: string | null;
    label: string | null;
    place_kind: 'facility' | 'home_group' | 'address' | null;
    site_name: string | null;
    common_notes: string | null;
    current_schedule_id: string;
    patients: Array<{
      schedule_id: string;
      patient_id: string;
      patient_name: string;
      unit_name: string | null;
      route_order: number | null;
      schedule_status: string;
      medication_start_date: string | null;
      medication_end_date: string | null;
      preparation_blockers_count: number;
      visit_record_id: string | null;
      visit_outcome_status: string | null;
    }>;
  } | null;
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
  conference_context: Array<{
    id: string;
    note_type: 'pre_discharge' | 'service_manager';
    title: string;
    conference_date: string;
    participants: Array<{
      name: string | null;
      role: string | null;
    }>;
    highlights: string[];
    action_items: string[];
    sync_summary?: {
      billing_candidate_id?: string | null;
      visit_proposal_id?: string | null;
      report_draft_ids?: string[];
      tasks_created?: number;
      medication_issues_created?: number;
    } | null;
  }>;
  billing_blockers: Array<
    HomeVisit2026BillingBlocker & {
      evidence_id: string;
      visit_record_id: string;
      action_href: string;
      action_label: string;
    }
  >;
  prescription_changes: {
    current_prescribed_date: string;
    previous_prescribed_date: string | null;
    source_type: string;
    added: string[];
    changed: Array<{
      drug_name: string;
      reasons: string[];
    }>;
    removed: string[];
  } | null;
  medication_period: {
    schedule_start_date: string | null;
    schedule_end_date: string | null;
    prescription_start_date: string | null;
    prescription_end_date: string | null;
  };
  home_care_feature_highlights: HomeCareFeatureState[];
  visit_brief: VisitBrief;
  onboarding_readiness: {
    consent_obtained: boolean;
    emergency_contact_set: boolean;
    first_visit_doc_delivered: boolean;
    management_plan_approved: boolean;
    primary_physician_set: boolean;
  } | null;
  intake_context: {
    initial_transition_management_expected: boolean | null;
  };
  emergency_contacts: Array<{
    id: string;
    name: string;
    relation: string;
    phone: string | null;
  }>;
  first_visit_document: {
    delivered_at: string | null;
    delivered_to: string | null;
  } | null;
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
  carry_items_status: string | null;
  scheduled_date: string;
  time_window_start: string | null;
  time_window_end: string | null;
  pharmacist_id: string;
  assignment_mode: AssignmentMode;
  route_order: number | null;
  facility_batch_id: string | null;
  confirmed_at: string | null;
  case_: {
    patient: {
      id: string;
      name: string;
      residences: Array<{
        address: string;
        building_id?: string | null;
        unit_name?: string | null;
        lat?: number | null;
        lng?: number | null;
      }>;
    };
  };
  site: {
    id: string;
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
  } | null;
  vehicle_resource?: VisitVehicleResourceSummary | null;
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
  change_requested: '変更希望',
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
  visit_carry_item_review: '持参物確認',
  facility_batch_tracker: '施設訪問',
  mobile_visit_mode: 'オフライン同期',
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

export function readImpactedPatientNames(
  impactSummary: Record<string, unknown> | null | undefined,
) {
  if (!impactSummary) return [];
  const value = impactSummary.impacted_patient_names;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
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
