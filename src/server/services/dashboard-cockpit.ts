import { PatientContactStatus, Prisma, ReportStatus } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { COCKPIT_CACHE_TTL_MS } from '@/lib/constants/workflow';
import { success, validationError } from '@/lib/api/response';
import { contactMethodLabel } from '@/lib/contact-profile-options';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { formatNullableDateKey } from '@/lib/date-key';
import { buildDispenseTaskHref } from '@/lib/dispense/navigation';
import { extractPackagingInstructionTags } from '@/lib/dispensing/packaging';
import { buildPatientHref } from '@/lib/patient/navigation';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import { buildReportHref, buildReportSendHref } from '@/lib/reports/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { buildSetPlanHref } from '@/lib/set/navigation';
import { canViewAllDashboardWork } from '@/lib/auth/visit-schedule-access';
import { buildVisitHref, buildVisitRecordHref } from '@/lib/visits/navigation';
import { applyTimeDateToDate, timeDateToString } from '@/lib/visits/time-of-day';
import { serverCache } from '@/lib/utils/server-cache';
import { japanDayInstantRange, todayUtcRange } from '@/lib/utils/date-boundary';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
  type DashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import {
  buildCockpitCacheKey,
  buildWorkflowAssignmentScopeFingerprint,
} from '@/server/services/workflow-dashboard-cache';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import { billingMonthForJapanTimestamp } from '@/server/services/billing-evidence';
import {
  buildVisitReadyReadinessBlockers,
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  VISIT_READY_PREPARATION_ITEMS,
  type VisitReadyPreparationChecklist,
} from '@/server/services/visit-preparation-readiness';
import type {
  CockpitAuditQueueItem,
  CockpitBlockedReason,
  CockpitCommentItem,
  CockpitInboundItem,
  CockpitVisit,
  DashboardCockpitCommentsResponse,
  DashboardCockpitDetailsResponse,
  DashboardCockpitInboundResponse,
  DashboardCockpitMedicationStockResponse,
  DashboardCockpitReportBillingResponse,
  DashboardCockpitResponse,
  DashboardCockpitScope,
  DashboardCockpitScopeMetadata,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
  DashboardMedicationStockRiskItem,
  DashboardReportBillingItem,
  DashboardUrgentItem,
} from '@/types/dashboard-cockpit';
import { buildTeamCapacity } from '@/app/api/dashboard/cockpit/team-capacity';

const AUDIT_QUEUE_FETCH_LIMIT = 30;
const AUDIT_QUEUE_RESPONSE_LIMIT = 5;
const BLOCKED_REASONS_LIMIT = 3;
const COMMENT_FEED_FETCH_LIMIT = 80;
const COMMENT_FEED_RESPONSE_LIMIT = 5;
const COMMENT_EXCERPT_LENGTH = 96;
const INBOUND_FEED_FETCH_LIMIT = 40;
const INBOUND_FEED_RESPONSE_LIMIT = 8;
const MEDICATION_STOCK_RISK_FETCH_LIMIT = 40;
const MEDICATION_STOCK_RISK_RESPONSE_LIMIT = 10;
const CALLBACK_URGENT_FETCH_LIMIT = 12;
const REPORT_URGENT_FETCH_LIMIT = 12;
const BILLING_URGENT_FETCH_LIMIT = 12;
const VISIT_PREPARATION_URGENT_FETCH_LIMIT = 12;
const REPORT_BILLING_ITEM_RESPONSE_LIMIT = 10;

type DashboardScopeQuery =
  | { ok: true; scope: DashboardCockpitScope | null }
  | { ok: false; response: ReturnType<typeof validationError> };

type DashboardCockpitPart =
  | 'full'
  | 'summary'
  | 'details'
  | 'team'
  | 'comments'
  | 'inbound'
  | 'stock-risks'
  | 'report-billing';

type DashboardCockpitSegmentResponse =
  | DashboardCockpitResponse
  | DashboardCockpitSummaryResponse
  | DashboardCockpitDetailsResponse
  | DashboardCockpitTeamResponse
  | DashboardCockpitCommentsResponse
  | DashboardCockpitInboundResponse
  | DashboardCockpitMedicationStockResponse
  | DashboardCockpitReportBillingResponse;

type DashboardCockpitScopeContext = {
  now: Date;
  todayRange: ReturnType<typeof todayUtcRange>;
  todayInstantStart: Date;
  requestedScope: DashboardCockpitScope | null;
  appliedScope: DashboardCockpitScope;
  canViewTeam: boolean;
  assignmentScope: DashboardAssignmentScope;
  metadata: DashboardCockpitScopeMetadata;
  cacheKey: string;
};

type AuditTaskLine = {
  packaging_instruction_tags: string[];
  packaging_instructions: string | null;
  notes: string | null;
  dispensing_method: string | null;
};

type AuditQueueCountRow = {
  count: bigint | number | string | null;
};

type AuditQueueSummaryRow = {
  total_count: bigint | number | string | null;
  narcotic_count: bigint | number | string | null;
  earliest_due_at: Date | string | null;
};

type DashboardAuditQueueSummary = {
  totalCount: number;
  narcoticCount: number;
  earliestDueAt: string | null;
};

type TodayVisitSummaryRow = {
  time_window_start: Date | null;
};

type DashboardCommentCandidate = {
  id: string;
  entity_type: CockpitCommentItem['entity_type'];
  entity_id: string;
  content: string;
  author_id: string;
  mentions: string[];
  created_at: Date;
};

type DashboardCallbackUrgentLog = {
  id: string;
  patient_id: string;
  schedule_id: string | null;
  outcome: string;
  contact_name: string | null;
  note: string | null;
  callback_due_at: Date | null;
  called_at: Date;
};

type DashboardCallbackUrgentResult = {
  items: DashboardUrgentItem[];
  totalCount: number;
};

type DashboardReportUrgentDelivery = {
  id: string;
  channel: string;
  recipient_name: string;
  failure_reason: string | null;
  retry_count: number;
  updated_at: Date;
  report: {
    id: string;
    patient_id: string;
    report_type: string;
  };
};

type DashboardReportUrgentResult = {
  items: DashboardUrgentItem[];
  totalCount: number;
};

type DashboardBillingUrgentCandidate = {
  id: string;
  patient_id: string | null;
  billing_month: Date;
  billing_code: string;
  billing_name: string;
  updated_at: Date;
};

type DashboardBillingUrgentResult = {
  items: DashboardUrgentItem[];
  totalCount: number;
};

type DashboardMedicationStockUrgentResult = {
  items: DashboardUrgentItem[];
  totalCount: number;
};

type DashboardMedicationStockSignalRow = {
  id: string;
  patient_id: string | null;
  case_id: string | null;
  inbound_event_id: string;
  signal_type: string;
  extracted_text: string | null;
  extracted_medication_name: string | null;
  extracted_quantity: number | null;
  extracted_unit: string | null;
  source_confidence: string;
  review_status: string;
  action_status: string;
  created_at: Date;
  updated_at: Date;
  inbound_event: {
    id: string;
    patient_id: string | null;
    case_id: string | null;
    source_channel: string;
    sender_role: string;
    normalized_summary: string | null;
    received_at: Date;
  };
};

type DashboardReportBillingDraftReport = {
  id: string;
  patient_id: string;
  report_type: string;
  status: string;
  updated_at: Date;
};

type DashboardReportBillingDelivery = {
  id: string;
  channel: string;
  recipient_name: string;
  failure_reason: string | null;
  status: string;
  retry_count: number;
  updated_at: Date;
  report: {
    id: string;
    patient_id: string;
    report_type: string;
  };
};

type DashboardVisitPreparationSchedule = {
  id: string;
  display_id: string | null;
  visit_type: string;
  priority: string;
  schedule_status: string;
  scheduled_date: Date;
  time_window_start: Date | null;
  carry_items_status: string | null;
  pre_visit_checklist_completed: boolean;
  updated_at: Date;
  preparation:
    | ({
        id: string;
        org_id: string;
        prepared_at: Date | null;
        updated_at: Date;
      } & VisitReadyPreparationChecklist)
    | null;
  case_: {
    patient: {
      id: string;
      name: string;
    };
  };
};

type DashboardVisitPreparationUrgentResult = {
  items: DashboardUrgentItem[];
  totalCount: number;
};

const TASK_PRIORITY_WEIGHT: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

const VISIT_PREPARATION_ACTIVE_STATUSES = ['planned', 'in_preparation'] as const;

const HANDLING_TAG_ORDER = [
  'narcotic',
  'cold_storage',
  'unit_dose',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'staple_required',
  'label_required',
];

const HANDLING_TAG_LABELS: Record<string, string> = {
  narcotic: '麻薬',
  cold_storage: '冷所',
  unit_dose: '一包化',
  half_tablet: '半錠',
  crush_prohibited: '粉砕不可',
  separate_pack: '別包',
  staple_required: 'ホチキス',
  label_required: 'ラベル',
};

const INBOUND_CHANNEL_LABELS: Record<string, string> = {
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
  mcs: 'MCS',
  in_person: '対面',
  patient_family: '患者・家族',
  facility_note: '施設連絡',
  external_api: '外部連携',
  manual: '手入力',
};

type DashboardInboundStatus = CockpitInboundItem['status'];

type DashboardInboundPriority = CockpitInboundItem['priority'];

export function parseDashboardScope(req: Request): DashboardScopeQuery {
  const values = new URL(req.url).searchParams.getAll('scope');
  if (values.length === 0) return { ok: true, scope: null };
  if (values.length > 1) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', {
        scope: ['scope は1つだけ指定してください'],
      }),
    };
  }

  const rawValue = values[0] ?? '';
  const scope = rawValue.trim();
  if (!scope || scope !== rawValue || (scope !== 'mine' && scope !== 'team')) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', { scope: ['scope が不正です'] }),
    };
  }

  return { ok: true, scope };
}

function collectHandlingTags(lines: AuditTaskLine[]): string[] {
  const tags = new Set<string>();
  for (const line of lines) {
    for (const tag of line.packaging_instruction_tags) {
      tags.add(tag);
    }
    if (line.dispensing_method === 'unit_dose') {
      tags.add('unit_dose');
    }
    for (const tag of extractPackagingInstructionTags({
      packagingInstructions: line.packaging_instructions,
      notes: line.notes,
    })) {
      tags.add(tag);
    }
  }
  return HANDLING_TAG_ORDER.filter((tag) => tags.has(tag));
}

function compareAuditQueueItems(left: CockpitAuditQueueItem, right: CockpitAuditQueueItem) {
  if (left.has_narcotic !== right.has_narcotic) return left.has_narcotic ? -1 : 1;
  const weightDiff =
    (TASK_PRIORITY_WEIGHT[left.priority] ?? 2) - (TASK_PRIORITY_WEIGHT[right.priority] ?? 2);
  if (weightDiff !== 0) return weightDiff;
  if (left.due_at && right.due_at) return left.due_at.localeCompare(right.due_at);
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  return (left.waiting_since ?? '').localeCompare(right.waiting_since ?? '');
}

const URGENT_SEVERITY_WEIGHT: Record<DashboardUrgentItem['severity'], number> = {
  blocking: 0,
  urgent: 1,
  warning: 2,
};

function compareDashboardUrgentItems(left: DashboardUrgentItem, right: DashboardUrgentItem) {
  const severityDiff =
    URGENT_SEVERITY_WEIGHT[left.severity] - URGENT_SEVERITY_WEIGHT[right.severity];
  if (severityDiff !== 0) return severityDiff;
  if (left.due_at && right.due_at) return left.due_at.localeCompare(right.due_at);
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  if (left.waiting_since && right.waiting_since) {
    return left.waiting_since.localeCompare(right.waiting_since);
  }
  if (left.waiting_since) return -1;
  if (right.waiting_since) return 1;
  return left.id.localeCompare(right.id);
}

function buildAuditUrgentItem(item: CockpitAuditQueueItem): DashboardUrgentItem {
  const severity =
    item.has_narcotic || item.priority === 'emergency'
      ? 'blocking'
      : item.priority === 'urgent'
        ? 'urgent'
        : 'warning';
  return {
    id: `audit:${item.task_id}`,
    source: 'audit',
    source_id: item.task_id,
    source_label: item.has_narcotic ? '麻薬監査' : '調剤監査',
    reference_label: formatPrescriptionCardNumber(
      item.intake_id ?? item.cycle_id,
      item.prescribed_date,
      'rx_year',
    ),
    severity,
    patient_id: null,
    patient_name: item.patient_name,
    title: item.has_narcotic ? '麻薬を含む監査待ち' : '調剤監査待ち',
    summary: item.has_narcotic
      ? '麻薬を含む監査待ちです。完了しないと訪問の持参準備が始まりません。'
      : '調剤済みの監査待ちです。完了でセット・訪問準備に進めます。',
    due_at: item.due_at,
    waiting_since: item.waiting_since,
    badges:
      item.handling_tags.length > 0
        ? item.handling_tags.map((tag) => ({
            label: HANDLING_TAG_LABELS[tag] ?? tag,
            tone: tag === 'narcotic' ? ('danger' as const) : ('warning' as const),
          }))
        : [{ label: '安全タグなし', tone: 'neutral' }],
    action_href: '/audit',
    action_label: '監査を開始する',
  };
}

function buildInboundUrgentItem(item: CockpitInboundItem): DashboardUrgentItem | null {
  if (item.status !== 'needs_review' && item.status !== 'reviewed_pending_action') return null;
  const severity = item.priority === 'urgent' ? 'urgent' : 'warning';
  const primarySignal = item.signals[0] ?? null;
  const signalSummary = primarySignal
    ? [
        primarySignal.extracted_medication_name,
        primarySignal.extracted_quantity != null && primarySignal.extracted_unit
          ? `${primarySignal.extracted_quantity}${primarySignal.extracted_unit}`
          : null,
        primarySignal.extracted_text,
      ]
        .filter(Boolean)
        .join(' / ')
    : item.summary;

  return {
    id: `inbound:${item.event_id}`,
    source: 'inbound',
    source_id: item.event_id,
    source_label: item.channel_label,
    reference_label: item.sender_role ?? item.channel_label,
    severity,
    patient_id: item.patient_id,
    patient_name: item.patient_name,
    title: item.title,
    summary: signalSummary || item.raw_text,
    due_at: item.due_at,
    waiting_since: item.received_at,
    badges: [
      {
        label: item.has_patient_safety_signal
          ? '安全確認'
          : item.has_medication_stock_signal
            ? '残数・薬剤'
            : '他職種受信',
        tone: item.has_patient_safety_signal
          ? 'danger'
          : item.has_medication_stock_signal
            ? 'success'
            : 'info',
      },
      {
        label: item.status === 'needs_review' ? '確認待ち' : '反映待ち',
        tone: item.status === 'needs_review' ? 'warning' : 'info',
      },
    ],
    action_href: item.action_href,
    action_label: item.action_label,
  };
}

function buildBlockedReasonUrgentItem(item: CockpitBlockedReason, now: Date): DashboardUrgentItem {
  const waitingSince = new Date(now.getTime() - item.age_minutes * 60_000).toISOString();
  const severity = item.severity === 'critical' ? 'blocking' : 'warning';

  return {
    id: `task:${item.id}`,
    source: 'task',
    source_id: item.id,
    source_label: '止まっている理由',
    reference_label: item.category,
    severity,
    patient_id: null,
    patient_name: null,
    title: item.label,
    summary: item.category ? `${item.category}: ${item.label}` : item.label,
    due_at: null,
    waiting_since: waitingSince,
    badges: [
      {
        label: item.category ?? '業務',
        tone: item.category === '患者' ? 'warning' : 'info',
      },
      {
        label: item.severity === 'critical' ? '重大' : '確認待ち',
        tone: item.severity === 'critical' ? 'danger' : 'warning',
      },
    ],
    action_href: item.action_href,
    action_label: item.action_label.replace(/\s*→\s*$/, '') || '状況を確認',
  };
}

const CALLBACK_OUTCOME_LABELS: Record<string, string> = {
  pending: '連絡待ち',
  attempted: '未接続',
  confirmed: '確認済み',
  declined: '辞退',
  change_requested: '変更希望',
  unreachable: '不通',
};

function buildCallbackUrgentItem(args: {
  log: DashboardCallbackUrgentLog;
  patientName: string | null;
  now: Date;
}): DashboardUrgentItem {
  const dueAt = args.log.callback_due_at?.toISOString() ?? null;
  const isOverdue = Boolean(args.log.callback_due_at && args.log.callback_due_at <= args.now);
  const statusLabel = CALLBACK_OUTCOME_LABELS[args.log.outcome] ?? args.log.outcome;
  const contactLabel = args.log.contact_name ? `連絡先: ${args.log.contact_name}` : '連絡先未指定';

  return {
    id: `callback:${args.log.id}`,
    source: 'callback',
    source_id: args.log.id,
    source_label: '折返し',
    reference_label: statusLabel,
    severity: isOverdue ? 'urgent' : 'warning',
    patient_id: args.log.patient_id,
    patient_name: args.patientName,
    title: isOverdue ? '患者連絡の折返し期限超過' : '患者連絡の折返し確認',
    summary: args.log.note?.trim() || contactLabel,
    due_at: dueAt,
    waiting_since: args.log.called_at.toISOString(),
    badges: [
      { label: '電話', tone: 'info' },
      { label: statusLabel, tone: isOverdue ? 'danger' : 'warning' },
    ],
    action_href: args.log.schedule_id
      ? buildScheduleFocusHref(args.log.schedule_id)
      : buildPatientHref(args.log.patient_id, '#patient-movement'),
    action_label: '折返しを確認',
  };
}

function formatReportTypeLabel(value: string) {
  switch (value) {
    case 'physician_report':
      return '医師向け報告';
    case 'care_manager_report':
      return 'ケアマネ報告';
    case 'facility_handoff':
      return '施設申し送り';
    case 'nurse_share':
      return '訪問看護共有';
    case 'family_share':
      return '家族共有';
    case 'internal_record':
      return '内部記録';
    default:
      return value;
  }
}

function buildReportDeliveryUrgentItem(args: {
  delivery: DashboardReportUrgentDelivery;
  patientName: string | null;
}): DashboardUrgentItem {
  const channelLabel = contactMethodLabel(args.delivery.channel);
  const recipientLabel = args.delivery.recipient_name?.trim() || '宛先未設定';
  const reason = args.delivery.failure_reason?.trim();
  const reportTypeLabel = formatReportTypeLabel(args.delivery.report.report_type);

  return {
    id: `report_delivery:${args.delivery.id}`,
    source: 'report',
    source_id: args.delivery.id,
    source_label: '報告書送付',
    reference_label: channelLabel,
    severity: 'blocking',
    patient_id: args.delivery.report.patient_id,
    patient_name: args.patientName,
    title: '報告書の送付失敗',
    summary: reason
      ? `${recipientLabel} / ${channelLabel} / 理由: ${reason}`
      : `${recipientLabel} への ${channelLabel} 送付が失敗しています。宛先とチャネルを確認してください。`,
    due_at: args.delivery.updated_at.toISOString(),
    waiting_since: args.delivery.updated_at.toISOString(),
    badges: [
      { label: reportTypeLabel, tone: 'info' },
      { label: channelLabel, tone: 'neutral' },
      {
        label: args.delivery.retry_count > 0 ? `再送${args.delivery.retry_count}回` : '再送未実施',
        tone: args.delivery.retry_count > 0 ? 'warning' : 'danger',
      },
    ],
    action_href: buildReportSendHref(args.delivery.report.id, {
      action: 'resend',
      deliveryRecordId: args.delivery.id,
    }),
    action_label: '宛先確認・再送',
  };
}

function formatBillingMonthKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatBillingMonthLabel(value: Date) {
  return value.toISOString().slice(0, 7);
}

function buildBillingCandidateHref(candidate: DashboardBillingUrgentCandidate) {
  const params = new URLSearchParams({
    billing_month: formatBillingMonthKey(candidate.billing_month),
    status: 'candidate',
    candidate_id: candidate.id,
  });
  if (candidate.patient_id) {
    params.set('patient_id', candidate.patient_id);
  }
  return `/billing/candidates?${params.toString()}`;
}

function buildBillingUrgentItem(args: {
  candidate: DashboardBillingUrgentCandidate;
  patientName: string | null;
}): DashboardUrgentItem {
  const monthLabel = formatBillingMonthLabel(args.candidate.billing_month);
  const referenceLabel = `${monthLabel} / ${args.candidate.billing_code}`;

  return {
    id: `billing:${args.candidate.id}`,
    source: 'billing',
    source_id: args.candidate.id,
    source_label: '算定候補',
    reference_label: referenceLabel,
    severity: 'warning',
    patient_id: args.candidate.patient_id,
    patient_name: args.patientName,
    title: '算定候補の確認待ち',
    summary: `${args.candidate.billing_name} の算定候補が未確認です。請求候補画面で根拠を確認してください。`,
    due_at: null,
    waiting_since: args.candidate.updated_at.toISOString(),
    badges: [
      { label: '請求候補', tone: 'warning' },
      { label: monthLabel, tone: 'neutral' },
    ],
    action_href: buildBillingCandidateHref(args.candidate),
    action_label: '算定候補へ',
  };
}

function formatReportStatusLabel(status: string) {
  switch (status) {
    case ReportStatus.draft:
      return '下書き';
    case ReportStatus.sent:
      return '送付済み';
    case ReportStatus.failed:
      return '送付失敗';
    case ReportStatus.confirmed:
      return '確認済み';
    case ReportStatus.response_waiting:
      return '受領確認待ち';
    default:
      return status;
  }
}

function buildReportDraftBillingItem(args: {
  report: DashboardReportBillingDraftReport;
  patientName: string | null;
}): DashboardReportBillingItem {
  const reportTypeLabel = formatReportTypeLabel(args.report.report_type);
  return {
    id: `report:${args.report.id}`,
    kind: 'report_draft',
    source_id: args.report.id,
    patient_id: args.report.patient_id,
    patient_name: args.patientName,
    title: '報告書の下書き確認',
    summary: `${reportTypeLabel} が下書きです。記載内容を確認して送付準備を進めてください。`,
    status: args.report.status,
    severity: 'warning',
    reference_label: reportTypeLabel,
    due_at: null,
    waiting_since: args.report.updated_at.toISOString(),
    updated_at: args.report.updated_at.toISOString(),
    action_href: buildReportHref(args.report.id),
    action_label: '報告書を開く',
    badges: [
      { label: reportTypeLabel, tone: 'info' },
      { label: formatReportStatusLabel(args.report.status), tone: 'warning' },
    ],
  };
}

function buildReportDeliveryBillingItem(args: {
  delivery: DashboardReportBillingDelivery;
  patientName: string | null;
}): DashboardReportBillingItem {
  const reportTypeLabel = formatReportTypeLabel(args.delivery.report.report_type);
  const statusLabel = formatReportStatusLabel(args.delivery.status);
  const channelLabel = contactMethodLabel(args.delivery.channel);
  const isFailed = args.delivery.status === ReportStatus.failed;
  const reason = args.delivery.failure_reason?.trim();
  return {
    id: `report_delivery:${args.delivery.id}`,
    kind: isFailed ? 'report_delivery_failed' : 'report_waiting_confirmation',
    source_id: args.delivery.id,
    patient_id: args.delivery.report.patient_id,
    patient_name: args.patientName,
    title: isFailed ? '報告書の送付失敗' : '報告書の受領確認待ち',
    summary:
      isFailed && reason
        ? `${args.delivery.recipient_name} / ${channelLabel} / 理由: ${reason}`
        : `${args.delivery.recipient_name} への ${channelLabel} 送付状況を確認してください。`,
    status: args.delivery.status,
    severity: isFailed ? 'blocking' : 'warning',
    reference_label: channelLabel,
    due_at: isFailed ? args.delivery.updated_at.toISOString() : null,
    waiting_since: args.delivery.updated_at.toISOString(),
    updated_at: args.delivery.updated_at.toISOString(),
    action_href: isFailed
      ? buildReportSendHref(args.delivery.report.id, {
          action: 'resend',
          deliveryRecordId: args.delivery.id,
        })
      : buildReportHref(args.delivery.report.id),
    action_label: isFailed ? '宛先確認・再送' : '送付状況を確認',
    badges: [
      { label: reportTypeLabel, tone: 'info' },
      { label: channelLabel, tone: 'neutral' },
      {
        label: isFailed
          ? args.delivery.retry_count > 0
            ? `再送${args.delivery.retry_count}回`
            : '再送未実施'
          : statusLabel,
        tone: isFailed ? 'danger' : 'warning',
      },
    ],
  };
}

function buildBillingCandidateReportBillingItem(args: {
  candidate: DashboardBillingUrgentCandidate;
  patientName: string | null;
}): DashboardReportBillingItem {
  const monthLabel = formatBillingMonthLabel(args.candidate.billing_month);
  return {
    id: `billing:${args.candidate.id}`,
    kind: 'billing_candidate_pending',
    source_id: args.candidate.id,
    patient_id: args.candidate.patient_id,
    patient_name: args.patientName,
    title: '算定候補の確認待ち',
    summary: `${args.candidate.billing_name} の算定候補が未確認です。請求候補画面で根拠を確認してください。`,
    status: 'candidate',
    severity: 'warning',
    reference_label: `${monthLabel} / ${args.candidate.billing_code}`,
    due_at: null,
    waiting_since: args.candidate.updated_at.toISOString(),
    updated_at: args.candidate.updated_at.toISOString(),
    action_href: buildBillingCandidateHref(args.candidate),
    action_label: '算定候補へ',
    badges: [
      { label: '請求候補', tone: 'warning' },
      { label: monthLabel, tone: 'neutral' },
      { label: args.candidate.billing_code, tone: 'info' },
    ],
  };
}

function compareReportBillingItems(
  left: DashboardReportBillingItem,
  right: DashboardReportBillingItem,
) {
  const statusWeight = (item: DashboardReportBillingItem) => {
    if (item.status === ReportStatus.failed) return 0;
    if (item.status === ReportStatus.draft) return 1;
    if (item.status === ReportStatus.response_waiting) return 2;
    if (item.kind === 'billing_candidate_pending') return 3;
    return 4;
  };
  const weightDiff = statusWeight(left) - statusWeight(right);
  if (weightDiff !== 0) return weightDiff;
  return right.updated_at.localeCompare(left.updated_at);
}

function getVerifiedVisitPreparation(schedule: DashboardVisitPreparationSchedule, orgId: string) {
  return schedule.preparation?.org_id === orgId ? schedule.preparation : null;
}

function countVisitPreparationReadyItems(preparation: VisitReadyPreparationChecklist | null) {
  if (!preparation) return 0;
  return VISIT_READY_PREPARATION_ITEMS.filter(([key]) => preparation[key]).length;
}

function buildVisitPreparationDueAt(schedule: DashboardVisitPreparationSchedule) {
  return applyTimeDateToDate(
    schedule.scheduled_date,
    schedule.time_window_start,
    '18:00',
  ).toISOString();
}

function buildVisitPreparationReferenceLabel(schedule: DashboardVisitPreparationSchedule) {
  const dateLabel = formatNullableDateKey(schedule.scheduled_date) ?? '訪問日未設定';
  const timeLabel = timeDateToString(schedule.time_window_start);
  return [schedule.display_id ?? dateLabel, timeLabel].filter(Boolean).join(' / ');
}

function buildVisitPreparationBlockers(args: {
  schedule: DashboardVisitPreparationSchedule;
  orgId: string;
}) {
  const preparation = getVerifiedVisitPreparation(args.schedule, args.orgId);
  const blockers = buildVisitReadyReadinessBlockers(preparation, args.schedule.carry_items_status);
  if (!args.schedule.pre_visit_checklist_completed) {
    blockers.push('出発前チェック未完了');
  }
  if (
    preparation &&
    countVisitPreparationReadyItems(preparation) === VISIT_READY_PREPARATION_ITEMS.length &&
    preparation.prepared_at == null
  ) {
    blockers.push('準備完了時刻未確定');
  }
  return Array.from(new Set(blockers));
}

function deriveVisitPreparationSeverity(args: {
  schedule: DashboardVisitPreparationSchedule;
  blockers: string[];
  now: Date;
}) {
  if (args.schedule.priority === 'emergency') return 'blocking' as const;
  if (
    args.schedule.carry_items_status === 'blocked' ||
    args.blockers.includes(VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER)
  ) {
    return args.schedule.carry_items_status === 'blocked'
      ? ('blocking' as const)
      : ('urgent' as const);
  }
  if (args.schedule.priority === 'urgent') return 'urgent' as const;
  const dueAt = new Date(buildVisitPreparationDueAt(args.schedule));
  if (dueAt.getTime() - args.now.getTime() <= 60 * 60_000) return 'urgent' as const;
  return 'warning' as const;
}

function summarizeVisitPreparationBlockers(blockers: string[]) {
  if (blockers.length === 0) return '訪問準備の確認が必要です。';
  const visible = blockers.slice(0, 3);
  const suffix =
    blockers.length > visible.length ? ` ほか${blockers.length - visible.length}件` : '';
  return `未完了: ${visible.join('、')}${suffix}`;
}

function buildVisitPreparationUrgentItem(args: {
  schedule: DashboardVisitPreparationSchedule;
  orgId: string;
  now: Date;
}): DashboardUrgentItem | null {
  const preparation = getVerifiedVisitPreparation(args.schedule, args.orgId);
  const blockers = buildVisitPreparationBlockers({
    schedule: args.schedule,
    orgId: args.orgId,
  });
  if (blockers.length === 0) return null;

  const readyCount = countVisitPreparationReadyItems(preparation);
  const severity = deriveVisitPreparationSeverity({
    schedule: args.schedule,
    blockers,
    now: args.now,
  });
  const title =
    args.schedule.carry_items_status === 'blocked'
      ? '訪問持参物がブロック中です'
      : preparation == null
        ? '訪問準備チェックが未作成です'
        : '訪問準備チェックが未完了です';

  return {
    id: `visit_preparation:${args.schedule.id}`,
    source: 'visit_preparation',
    source_id: preparation?.id ?? args.schedule.id,
    source_label: '訪問準備',
    reference_label: buildVisitPreparationReferenceLabel(args.schedule),
    severity,
    patient_id: args.schedule.case_.patient.id,
    patient_name: args.schedule.case_.patient.name,
    title,
    summary: summarizeVisitPreparationBlockers(blockers),
    due_at: buildVisitPreparationDueAt(args.schedule),
    waiting_since: (preparation?.updated_at ?? args.schedule.updated_at).toISOString(),
    badges: [
      { label: '訪問準備', tone: 'info' },
      {
        label: `準備 ${readyCount}/${VISIT_READY_PREPARATION_ITEMS.length}`,
        tone:
          readyCount === VISIT_READY_PREPARATION_ITEMS.length
            ? 'success'
            : severity === 'blocking'
              ? 'danger'
              : 'warning',
      },
      ...(args.schedule.carry_items_status === 'blocked' ||
      args.schedule.carry_items_status === 'partial'
        ? [
            {
              label:
                args.schedule.carry_items_status === 'blocked' ? '持参物ブロック' : '持参物未確定',
              tone:
                args.schedule.carry_items_status === 'blocked'
                  ? ('danger' as const)
                  : ('warning' as const),
            },
          ]
        : []),
    ],
    action_href: buildVisitRecordHref(args.schedule.id),
    action_label: '準備を確認',
  };
}

function buildDashboardUrgentItems(args: {
  auditItems: CockpitAuditQueueItem[];
  inboundItems?: CockpitInboundItem[];
  medicationStockItems?: DashboardUrgentItem[];
  visitPreparationItems?: DashboardUrgentItem[];
  callbackItems?: DashboardUrgentItem[];
  reportItems?: DashboardUrgentItem[];
  billingItems?: DashboardUrgentItem[];
  blockedReasons?: CockpitBlockedReason[];
  now: Date;
}) {
  return [
    ...args.auditItems.map(buildAuditUrgentItem),
    ...(args.inboundItems ?? [])
      .map(buildInboundUrgentItem)
      .filter((item): item is DashboardUrgentItem => item != null),
    ...(args.medicationStockItems ?? []),
    ...(args.visitPreparationItems ?? []),
    ...(args.callbackItems ?? []),
    ...(args.reportItems ?? []),
    ...(args.billingItems ?? []),
    ...(args.blockedReasons ?? []).map((reason) => buildBlockedReasonUrgentItem(reason, args.now)),
  ].sort(compareDashboardUrgentItems);
}

function readCount(value: AuditQueueCountRow['count'] | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function buildSegmentCacheKey(baseKey: string, part: DashboardCockpitPart) {
  return part === 'full' ? baseKey : `${baseKey}:${part}`;
}

async function countAuditQueueItems(args: { orgId: string; caseIds?: string[] }) {
  if (args.caseIds && args.caseIds.length === 0) return 0;

  const caseScope = args.caseIds
    ? Prisma.sql`AND cycle."case_id" IN (${Prisma.join(args.caseIds)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<AuditQueueCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "DispenseTask" task
    INNER JOIN "MedicationCycle" cycle
      ON cycle."id" = task."cycle_id"
      AND cycle."org_id" = task."org_id"
    LEFT JOIN LATERAL (
      SELECT audit."result"
      FROM "DispenseAudit" audit
      WHERE audit."task_id" = task."id"
        AND audit."org_id" = task."org_id"
      ORDER BY audit."audited_at" DESC, audit."created_at" DESC, audit."id" DESC
      LIMIT 1
    ) latest_audit ON TRUE
    WHERE task."org_id" = ${args.orgId}
      AND task."status" = 'completed'
      ${caseScope}
      AND (latest_audit."result" IS NULL OR latest_audit."result"::text = 'hold')
  `);

  return readCount(rows[0]?.count);
}

async function readAuditQueueSummary(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Promise<DashboardAuditQueueSummary> {
  if (args.assignmentScope.caseIds && args.assignmentScope.caseIds.length === 0) {
    return { totalCount: 0, narcoticCount: 0, earliestDueAt: null };
  }

  const caseScope = args.assignmentScope.caseIds
    ? Prisma.sql`AND cycle."case_id" IN (${Prisma.join(args.assignmentScope.caseIds)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<AuditQueueSummaryRow[]>(Prisma.sql`
    SELECT
      COUNT(DISTINCT task."id")::bigint AS total_count,
      COUNT(DISTINCT task."id") FILTER (
        WHERE
          line."packaging_instruction_tags" @> ARRAY['narcotic'::"PackagingInstructionTag"]
          OR line."packaging_instructions" ILIKE '%麻薬%'
          OR line."notes" ILIKE '%麻薬%'
      )::bigint AS narcotic_count,
      MIN(task."due_date") AS earliest_due_at
    FROM "DispenseTask" task
    INNER JOIN "MedicationCycle" cycle
      ON cycle."id" = task."cycle_id"
      AND cycle."org_id" = task."org_id"
    LEFT JOIN LATERAL (
      SELECT audit."result"
      FROM "DispenseAudit" audit
      WHERE audit."task_id" = task."id"
        AND audit."org_id" = task."org_id"
      ORDER BY audit."audited_at" DESC, audit."created_at" DESC, audit."id" DESC
      LIMIT 1
    ) latest_audit ON TRUE
    LEFT JOIN LATERAL (
      SELECT intake."id"
      FROM "PrescriptionIntake" intake
      WHERE intake."cycle_id" = cycle."id"
        AND intake."org_id" = cycle."org_id"
      ORDER BY intake."created_at" DESC
      LIMIT 1
    ) latest_intake ON TRUE
    LEFT JOIN "PrescriptionLine" line
      ON line."intake_id" = latest_intake."id"
      AND line."org_id" = task."org_id"
    WHERE task."org_id" = ${args.orgId}
      AND task."status" = 'completed'
      ${caseScope}
      AND (latest_audit."result" IS NULL OR latest_audit."result"::text = 'hold')
  `);

  const row = rows[0];
  const earliestDueAt = row?.earliest_due_at;
  return {
    totalCount: readCount(row?.total_count),
    narcoticCount: readCount(row?.narcotic_count),
    earliestDueAt:
      earliestDueAt instanceof Date
        ? earliestDueAt.toISOString()
        : typeof earliestDueAt === 'string'
          ? earliestDueAt
          : null,
  };
}

async function resolveCockpitScopeContext(args: {
  ctx: AuthContext;
  requestedScope: DashboardCockpitScope | null;
  part: DashboardCockpitPart;
}): Promise<DashboardCockpitScopeContext> {
  const now = new Date();
  const canViewTeam = canViewAllDashboardWork(args.ctx);
  const appliedScope: DashboardCockpitScope =
    args.requestedScope === 'team'
      ? canViewTeam
        ? 'team'
        : 'mine'
      : args.requestedScope === 'mine'
        ? 'mine'
        : canViewTeam
          ? 'team'
          : 'mine';
  const todayRange = todayUtcRange(now);
  const todayInstantStart = japanDayInstantRange(now).gte;
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: args.ctx.orgId,
    accessContext: args.ctx,
    scope: args.requestedScope ? appliedScope : 'role_default',
  });
  const baseCacheKey = buildCockpitCacheKey(
    args.ctx.orgId,
    args.ctx.role,
    args.ctx.userId,
    todayRange.gte,
    appliedScope,
    buildWorkflowAssignmentScopeFingerprint(assignmentScope),
  );

  return {
    now,
    todayRange,
    todayInstantStart,
    requestedScope: args.requestedScope,
    appliedScope,
    canViewTeam,
    assignmentScope,
    metadata: {
      generated_at: now.toISOString(),
      scope: {
        requested: args.requestedScope ?? appliedScope,
        applied: appliedScope,
        can_view_team: canViewTeam,
      },
    },
    cacheKey: buildSegmentCacheKey(baseCacheKey, args.part),
  };
}

function buildCycleCaseScope(assignmentScope: DashboardAssignmentScope) {
  return assignmentScope.caseIds ? { case_id: { in: assignmentScope.caseIds } } : {};
}

async function readCycleStatusCounts(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}) {
  const rows = await prisma.medicationCycle.groupBy({
    by: ['overall_status'],
    where: {
      org_id: args.orgId,
      ...buildCycleCaseScope(args.assignmentScope),
      overall_status: { notIn: ['cancelled'] },
    },
    _count: { id: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.overall_status] = row._count.id;
  }
  return counts;
}

async function readAuditQueue(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Promise<{ all: CockpitAuditQueueItem[]; totalCount: number }> {
  const [auditTasks, totalCount] = await Promise.all([
    prisma.dispenseTask.findMany({
      where: {
        org_id: args.orgId,
        status: 'completed',
        ...(args.assignmentScope.caseIds
          ? { cycle: { case_id: { in: args.assignmentScope.caseIds } } }
          : {}),
      },
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }, { updated_at: 'asc' }],
      take: AUDIT_QUEUE_FETCH_LIMIT,
      select: {
        id: true,
        priority: true,
        due_date: true,
        updated_at: true,
        audits: {
          orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { result: true },
        },
        cycle: {
          select: {
            id: true,
            case_: {
              select: {
                patient: { select: { name: true } },
              },
            },
            prescription_intakes: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                id: true,
                prescribed_date: true,
                lines: {
                  select: {
                    packaging_instruction_tags: true,
                    packaging_instructions: true,
                    notes: true,
                    dispensing_method: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    countAuditQueueItems({
      orgId: args.orgId,
      caseIds: args.assignmentScope.caseIds,
    }),
  ]);

  const all = auditTasks
    .filter((task) => {
      const latestAudit = task.audits[0] ?? null;
      return latestAudit == null || latestAudit.result === 'hold';
    })
    .map((task) => {
      const intake = task.cycle.prescription_intakes[0] ?? null;
      const handlingTags = collectHandlingTags(intake?.lines ?? []);
      return {
        task_id: task.id,
        cycle_id: task.cycle.id,
        patient_name: task.cycle.case_.patient.name,
        priority: task.priority,
        due_at: task.due_date?.toISOString() ?? null,
        intake_id: intake?.id ?? null,
        prescribed_date: formatNullableDateKey(intake?.prescribed_date ?? null),
        handling_tags: handlingTags,
        has_narcotic: handlingTags.includes('narcotic'),
        waiting_since: task.updated_at?.toISOString() ?? null,
      } satisfies CockpitAuditQueueItem;
    })
    .sort(compareAuditQueueItems);

  return { all, totalCount };
}

async function readTodayVisits(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  todayRange: ReturnType<typeof todayUtcRange>;
}) {
  const rows = await prisma.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      ...buildCycleCaseScope(args.assignmentScope),
      scheduled_date: args.todayRange,
      schedule_status: { notIn: ['cancelled', 'rescheduled'] },
    },
    orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
    select: {
      id: true,
      visit_type: true,
      schedule_status: true,
      time_window_start: true,
      time_window_end: true,
      facility_batch_id: true,
      pharmacist_id: true,
      case_: {
        select: {
          patient: { select: { name: true } },
        },
      },
    },
  });

  return rows;
}

async function readTodayVisitSummary(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  todayRange: ReturnType<typeof todayUtcRange>;
}) {
  const rows = await prisma.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      ...buildCycleCaseScope(args.assignmentScope),
      scheduled_date: args.todayRange,
      schedule_status: { notIn: ['cancelled', 'rescheduled'] },
    },
    orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
    select: {
      time_window_start: true,
    },
  });

  return {
    count: rows.length,
    times: rows
      .map((schedule: TodayVisitSummaryRow) => timeDateToString(schedule.time_window_start))
      .filter((value): value is string => value != null),
  };
}

function mapTodayVisits(rows: Awaited<ReturnType<typeof readTodayVisits>>): CockpitVisit[] {
  return rows.map((schedule) => ({
    id: schedule.id,
    patient_name: schedule.case_.patient.name,
    visit_type: schedule.visit_type,
    schedule_status: schedule.schedule_status,
    time_start: timeDateToString(schedule.time_window_start) ?? null,
    time_end: timeDateToString(schedule.time_window_end) ?? null,
    facility_batch_id: schedule.facility_batch_id,
  }));
}

const DASHBOARD_COMMENT_ENTITY_LABELS: Record<CockpitCommentItem['entity_type'], string> = {
  dispense_task: '調剤',
  medication_cycle: '処方サイクル',
  set_plan: 'セット',
  visit_record: '訪問記録',
  care_report: '報告書',
  patient: '患者',
};

function isDashboardCommentEntityType(value: string): value is CockpitCommentItem['entity_type'] {
  return value in DASHBOARD_COMMENT_ENTITY_LABELS;
}

function hasRestrictedDashboardScope(assignmentScope: DashboardAssignmentScope) {
  return assignmentScope.caseIds !== undefined || assignmentScope.patientIds !== undefined;
}

function createEntityIdBucket() {
  return {
    dispense_task: new Set<string>(),
    medication_cycle: new Set<string>(),
    set_plan: new Set<string>(),
    visit_record: new Set<string>(),
    care_report: new Set<string>(),
    patient: new Set<string>(),
  } satisfies Record<CockpitCommentItem['entity_type'], Set<string>>;
}

function normalizeCommentExcerpt(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'コメント本文なし';
  if (normalized.length <= COMMENT_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, COMMENT_EXCERPT_LENGTH - 1)}…`;
}

function buildDashboardCommentHref(
  comment: Pick<CockpitCommentItem, 'entity_type' | 'entity_id'>,
  cyclePatientIds: Map<string, string>,
) {
  switch (comment.entity_type) {
    case 'patient':
      return buildPatientHref(comment.entity_id);
    case 'dispense_task':
      return buildDispenseTaskHref(comment.entity_id);
    case 'set_plan':
      return buildSetPlanHref(comment.entity_id);
    case 'visit_record':
      return buildVisitHref(comment.entity_id);
    case 'care_report':
      return buildReportHref(comment.entity_id);
    case 'medication_cycle': {
      const patientId = cyclePatientIds.get(comment.entity_id);
      return patientId ? buildPatientHref(patientId) : '/handoff';
    }
    default:
      return '/handoff';
  }
}

function buildInboundCommunicationWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}) {
  if (args.assignmentScope.caseIds === undefined && args.assignmentScope.patientIds === undefined) {
    return { org_id: args.orgId };
  }

  const clauses = [
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ patient_id: { in: args.assignmentScope.patientIds } }]
      : []),
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
  ];

  return clauses.length > 0
    ? { org_id: args.orgId, OR: clauses }
    : { org_id: args.orgId, id: { in: [] } };
}

function buildDashboardCallbackWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Prisma.VisitScheduleContactLogWhereInput {
  const scopeClauses = [
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ patient_id: { in: args.assignmentScope.patientIds } }]
      : []),
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
  ];
  const hasRestrictedScope =
    args.assignmentScope.patientIds !== undefined || args.assignmentScope.caseIds !== undefined;

  return {
    org_id: args.orgId,
    ...(hasRestrictedScope
      ? scopeClauses.length > 0
        ? { OR: scopeClauses }
        : { id: { in: [] } }
      : {}),
    AND: [
      {
        OR: [
          { callback_due_at: { not: null } },
          {
            outcome: {
              in: [PatientContactStatus.attempted, PatientContactStatus.unreachable],
            },
          },
        ],
      },
    ],
  };
}

function buildDashboardReportDeliveryWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Prisma.DeliveryRecordWhereInput {
  const reportScopeClauses = [
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ patient_id: { in: args.assignmentScope.patientIds } }]
      : []),
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
  ];
  const hasRestrictedScope =
    args.assignmentScope.patientIds !== undefined || args.assignmentScope.caseIds !== undefined;

  return {
    org_id: args.orgId,
    status: ReportStatus.failed,
    ...(hasRestrictedScope
      ? reportScopeClauses.length > 0
        ? { report: { OR: reportScopeClauses } }
        : { id: { in: [] } }
      : {}),
  };
}

function buildDashboardCareReportWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  status?: ReportStatus;
}): Prisma.CareReportWhereInput {
  const reportScopeClauses = [
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ patient_id: { in: args.assignmentScope.patientIds } }]
      : []),
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
  ];
  const hasRestrictedScope =
    args.assignmentScope.patientIds !== undefined || args.assignmentScope.caseIds !== undefined;

  return {
    org_id: args.orgId,
    ...(args.status ? { status: args.status } : {}),
    ...(hasRestrictedScope
      ? reportScopeClauses.length > 0
        ? { OR: reportScopeClauses }
        : { id: { in: [] } }
      : {}),
  };
}

function buildDashboardReportDeliveryStatusWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  statuses: ReportStatus[];
}): Prisma.DeliveryRecordWhereInput {
  return {
    ...buildDashboardReportDeliveryWhere({
      orgId: args.orgId,
      assignmentScope: args.assignmentScope,
    }),
    status: { in: args.statuses },
  };
}

function buildDashboardBillingCandidateWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  billingMonth: Date;
}): Prisma.BillingCandidateWhereInput {
  const hasRestrictedScope =
    args.assignmentScope.patientIds !== undefined || args.assignmentScope.caseIds !== undefined;
  const patientIds = args.assignmentScope.patientIds ?? [];

  return {
    org_id: args.orgId,
    billing_domain: 'home_care',
    billing_month: args.billingMonth,
    status: 'candidate',
    ...(hasRestrictedScope
      ? patientIds.length > 0
        ? { patient_id: { in: patientIds } }
        : { id: { in: [] } }
      : {}),
  };
}

function buildDashboardVisitPreparationWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  todayRange: ReturnType<typeof todayUtcRange>;
}): Prisma.VisitScheduleWhereInput {
  const hasRestrictedScope =
    args.assignmentScope.caseIds !== undefined || args.assignmentScope.patientIds !== undefined;
  const scopeClauses = [
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ case_: { org_id: args.orgId, patient_id: { in: args.assignmentScope.patientIds } } }]
      : []),
  ];

  return {
    org_id: args.orgId,
    scheduled_date: args.todayRange,
    schedule_status: { in: [...VISIT_PREPARATION_ACTIVE_STATUSES] },
    ...(hasRestrictedScope
      ? scopeClauses.length > 0
        ? { OR: scopeClauses }
        : { id: { in: [] } }
      : {}),
    AND: [
      {
        OR: [
          { pre_visit_checklist_completed: false },
          { carry_items_status: { in: ['blocked', 'partial'] } },
          { preparation: { is: null } },
          { preparation: { is: { prepared_at: null } } },
          { preparation: { is: { medication_changes_reviewed: false } } },
          { preparation: { is: { carry_items_confirmed: false } } },
          { preparation: { is: { previous_issues_reviewed: false } } },
          { preparation: { is: { route_confirmed: false } } },
          { preparation: { is: { offline_synced: false } } },
        ],
      },
    ],
  };
}

function buildInboundCommunicationHref(event: { id: string; patient_id: string | null }) {
  if (event.patient_id) return buildPatientHref(event.patient_id, '#inbound-communications');
  return `/communications/inbound?event=${encodeURIComponent(event.id)}`;
}

function deriveInboundStatus(args: {
  processingStatus: string;
  signals: Array<{ review_status: string; action_status: string }>;
}): DashboardInboundStatus {
  if (args.signals.some((signal) => signal.action_status === 'linked_to_task')) {
    return 'task_created';
  }
  if (args.signals.some((signal) => signal.review_status === 'needs_review')) {
    return 'needs_review';
  }
  if (
    args.signals.some(
      (signal) =>
        (signal.review_status === 'accepted' || signal.review_status === 'auto_accepted') &&
        signal.action_status === 'not_linked',
    )
  ) {
    return 'reviewed_pending_action';
  }
  if (args.processingStatus === 'unprocessed' || args.processingStatus === 'signals_extracted') {
    return 'needs_review';
  }
  if (args.processingStatus === 'converted_to_task') return 'task_created';
  if (args.processingStatus === 'linked_to_workflow') return 'task_completed';
  return 'task_completed';
}

function deriveInboundPriority(args: {
  hasPatientSafetySignal: boolean;
  hasMedicationStockSignal: boolean;
  status: DashboardInboundStatus;
  signals: Array<{ signal_domain: string; signal_type: string }>;
}): DashboardInboundPriority {
  if (
    args.hasPatientSafetySignal ||
    args.signals.some(
      (signal) => signal.signal_domain === 'urgent' || signal.signal_type.includes('side_effect'),
    )
  ) {
    return 'urgent';
  }
  if (args.status === 'needs_review' || args.hasMedicationStockSignal) return 'high';
  return 'normal';
}

function buildInboundTitle(args: {
  channelLabel: string;
  hasMedicationStockSignal: boolean;
  hasPatientSafetySignal: boolean;
}) {
  if (args.hasPatientSafetySignal) return `${args.channelLabel}受信: 安全確認が必要`;
  if (args.hasMedicationStockSignal) return `${args.channelLabel}受信: 残数・薬剤情報あり`;
  return `${args.channelLabel}連絡を受信`;
}

function buildDashboardMedicationStockSignalWhere(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Prisma.InboundCommunicationSignalWhereInput {
  const restricted = hasRestrictedDashboardScope(args.assignmentScope);
  const scopeClauses = [
    ...(args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0
      ? [{ patient_id: { in: args.assignmentScope.patientIds } }]
      : []),
    ...(args.assignmentScope.caseIds && args.assignmentScope.caseIds.length > 0
      ? [{ case_id: { in: args.assignmentScope.caseIds } }]
      : []),
  ];

  const statusWhere: Prisma.InboundCommunicationSignalWhereInput = {
    OR: [
      { review_status: 'needs_review' },
      { action_status: 'not_linked' },
      { action_status: 'linked_to_task' },
      { action_status: 'linked_to_stock_event' },
    ],
  };

  return {
    org_id: args.orgId,
    signal_domain: 'medication_stock',
    ...(restricted
      ? scopeClauses.length > 0
        ? { AND: [{ OR: scopeClauses }, statusWhere] }
        : { id: { in: [] } }
      : statusWhere),
  };
}

function medicationStockRiskLevel(signal: DashboardMedicationStockSignalRow) {
  if (signal.action_status === 'linked_to_stock_event') return 'linked';
  if (signal.signal_type === 'out_of_stock_text') return 'urgent';
  if (signal.signal_type === 'observed_quantity' && signal.extracted_quantity === 0) {
    return 'urgent';
  }
  if (signal.signal_type === 'low_stock_text' || signal.signal_type === 'refill_request') {
    return 'shortage_expected';
  }
  if (signal.signal_type === 'usage_frequency' || signal.signal_type === 'usage_delta') {
    return 'usage_unknown';
  }
  return 'review_required';
}

function medicationStockRiskLabel(riskLevel: DashboardMedicationStockRiskItem['risk_level']) {
  switch (riskLevel) {
    case 'urgent':
      return '不足報告';
    case 'shortage_expected':
      return '不足見込み';
    case 'usage_unknown':
      return '使用状況確認';
    case 'linked':
      return '台帳反映済み';
    case 'review_required':
      return '確認待ち';
  }
}

function medicationStockRiskBadgeTone(
  riskLevel: DashboardMedicationStockRiskItem['risk_level'],
): DashboardMedicationStockRiskItem['badges'][number]['tone'] {
  switch (riskLevel) {
    case 'urgent':
      return 'danger';
    case 'shortage_expected':
    case 'usage_unknown':
      return 'warning';
    case 'linked':
      return 'success';
    case 'review_required':
      return 'info';
  }
}

function formatMedicationStockQuantity(signal: DashboardMedicationStockSignalRow) {
  if (signal.extracted_quantity == null || !signal.extracted_unit) return null;
  return `${signal.extracted_quantity}${signal.extracted_unit}`;
}

function buildMedicationStockSignalHref(signal: DashboardMedicationStockSignalRow) {
  const patientId = signal.patient_id ?? signal.inbound_event.patient_id;
  if (patientId) {
    return buildPatientHref(patientId, '#medication-stock-events');
  }
  return `/communications/inbound?signal=${encodeURIComponent(signal.id)}`;
}

function buildMedicationStockRiskItem(args: {
  signal: DashboardMedicationStockSignalRow;
  patientName: string | null;
}): DashboardMedicationStockRiskItem {
  const signal = args.signal;
  const riskLevel = medicationStockRiskLevel(signal);
  const quantityLabel = formatMedicationStockQuantity(signal);
  const channel = String(signal.inbound_event.source_channel);
  const sourceLabel = INBOUND_CHANNEL_LABELS[channel] ?? '受信';
  const sourceText = signal.extracted_text ?? signal.inbound_event.normalized_summary ?? null;

  return {
    id: `medication_stock_signal:${signal.id}`,
    source: 'inbound_signal',
    signal_id: signal.id,
    inbound_event_id: signal.inbound_event_id,
    patient_id: signal.patient_id ?? signal.inbound_event.patient_id,
    patient_name: args.patientName,
    case_id: signal.case_id ?? signal.inbound_event.case_id,
    risk_level: riskLevel,
    signal_type: signal.signal_type,
    review_status: signal.review_status,
    action_status: signal.action_status,
    medication_name: signal.extracted_medication_name,
    quantity_label: quantityLabel,
    source_text: sourceText,
    source_channel: channel,
    source_label: sourceLabel,
    sender_role: String(signal.inbound_event.sender_role),
    received_at: signal.inbound_event.received_at.toISOString(),
    updated_at: signal.updated_at.toISOString(),
    action_href: buildMedicationStockSignalHref(signal),
    action_label:
      signal.action_status === 'linked_to_stock_event' ? '残数反映を確認' : '残数報告を確認',
    badges: [
      { label: medicationStockRiskLabel(riskLevel), tone: medicationStockRiskBadgeTone(riskLevel) },
      { label: sourceLabel, tone: 'neutral' },
      ...(quantityLabel ? [{ label: quantityLabel, tone: 'info' as const }] : []),
      ...(signal.extracted_medication_name
        ? [{ label: signal.extracted_medication_name, tone: 'info' as const }]
        : [{ label: '薬剤名確認', tone: 'warning' as const }]),
    ],
  };
}

function buildMedicationStockUrgentItem(
  item: DashboardMedicationStockRiskItem,
): DashboardUrgentItem | null {
  if (item.risk_level === 'linked') return null;

  const severity = item.risk_level === 'urgent' ? 'urgent' : 'warning';
  const medicationLabel = item.medication_name ?? '薬剤名確認';
  const quantityLabel = item.quantity_label ? ` / ${item.quantity_label}` : '';
  const sourceText = item.source_text?.trim();
  const summary = sourceText
    ? `${medicationLabel}${quantityLabel}: ${sourceText}`
    : `${medicationLabel}${quantityLabel} の残数・使用状況を確認してください。`;

  return {
    id: `medication_stock:${item.signal_id}`,
    source: 'medication_stock',
    source_id: item.signal_id,
    source_label: '残数管理',
    reference_label: item.source_label,
    severity,
    patient_id: item.patient_id,
    patient_name: item.patient_name,
    title: item.risk_level === 'urgent' ? '外用薬・頓服薬の不足報告' : '外用薬・頓服薬の残数確認',
    summary,
    due_at: item.risk_level === 'urgent' ? item.received_at : null,
    waiting_since: item.received_at,
    badges: item.badges,
    action_href: item.action_href,
    action_label: item.action_label,
  };
}

async function readAllowedCommentEntities(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  entityIds: Record<CockpitCommentItem['entity_type'], Set<string>>;
}) {
  const allowed = createEntityIdBucket();
  const cyclePatientIds = new Map<string, string>();
  const restricted = hasRestrictedDashboardScope(args.assignmentScope);

  if (!restricted) {
    for (const entityType of Object.keys(args.entityIds) as CockpitCommentItem['entity_type'][]) {
      for (const id of args.entityIds[entityType]) {
        allowed[entityType].add(id);
      }
    }
  } else if (args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0) {
    const allowedPatientIds = new Set(args.assignmentScope.patientIds);
    for (const id of args.entityIds.patient) {
      if (allowedPatientIds.has(id)) allowed.patient.add(id);
    }
  }

  const caseIds = args.assignmentScope.caseIds;
  const hasCaseScope = caseIds === undefined || caseIds.length > 0;

  const cycleIds = Array.from(args.entityIds.medication_cycle);
  const dispenseTaskIds = Array.from(args.entityIds.dispense_task);
  const setPlanIds = Array.from(args.entityIds.set_plan);
  const visitRecordIds = Array.from(args.entityIds.visit_record);
  const careReportIds = Array.from(args.entityIds.care_report);

  const [cycles, dispenseTasks, setPlans, visitRecords, careReports] = await Promise.all([
    cycleIds.length > 0 && hasCaseScope
      ? prisma.medicationCycle.findMany({
          where: {
            id: { in: cycleIds },
            org_id: args.orgId,
            ...(caseIds ? { case_id: { in: caseIds } } : {}),
          },
          select: { id: true, patient_id: true },
        })
      : [],
    dispenseTaskIds.length > 0 && hasCaseScope
      ? prisma.dispenseTask.findMany({
          where: {
            id: { in: dispenseTaskIds },
            org_id: args.orgId,
            ...(caseIds ? { cycle: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    setPlanIds.length > 0 && hasCaseScope
      ? prisma.setPlan.findMany({
          where: {
            id: { in: setPlanIds },
            org_id: args.orgId,
            ...(caseIds ? { cycle: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    visitRecordIds.length > 0 && hasCaseScope
      ? prisma.visitRecord.findMany({
          where: {
            id: { in: visitRecordIds },
            org_id: args.orgId,
            ...(caseIds ? { schedule: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    careReportIds.length > 0 && hasCaseScope
      ? prisma.careReport.findMany({
          where: {
            id: { in: careReportIds },
            org_id: args.orgId,
            ...(caseIds
              ? {
                  OR: [
                    { case_id: { in: caseIds } },
                    ...(args.assignmentScope.patientIds &&
                    args.assignmentScope.patientIds.length > 0
                      ? [
                          {
                            case_id: null,
                            patient_id: { in: args.assignmentScope.patientIds },
                          },
                        ]
                      : []),
                  ],
                }
              : {}),
          },
          select: { id: true },
        })
      : [],
  ]);

  for (const cycle of cycles) {
    allowed.medication_cycle.add(cycle.id);
    cyclePatientIds.set(cycle.id, cycle.patient_id);
  }
  for (const task of dispenseTasks) allowed.dispense_task.add(task.id);
  for (const plan of setPlans) allowed.set_plan.add(plan.id);
  for (const record of visitRecords) allowed.visit_record.add(record.id);
  for (const report of careReports) allowed.care_report.add(report.id);

  return { allowed, cyclePatientIds };
}

async function readDashboardInbound(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCockpitInboundResponse> {
  const where = buildInboundCommunicationWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
  });
  const [events, totalCount] = await Promise.all([
    prisma.inboundCommunicationEvent.findMany({
      where,
      orderBy: [{ received_at: 'desc' }, { id: 'asc' }],
      take: INBOUND_FEED_FETCH_LIMIT,
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        source_channel: true,
        sender_name: true,
        sender_role: true,
        sender_organization_name: true,
        sender_contact: true,
        event_type: true,
        received_at: true,
        occurred_at: true,
        raw_text: true,
        normalized_summary: true,
        attachment_count: true,
        has_medication_stock_signal: true,
        has_patient_safety_signal: true,
        has_schedule_signal: true,
        has_report_signal: true,
        processing_status: true,
      },
    }),
    prisma.inboundCommunicationEvent.count({ where }),
  ]);

  const visibleEvents = events.slice(0, INBOUND_FEED_RESPONSE_LIMIT);
  const eventIds = visibleEvents.map((event) => event.id);
  const patientIds = Array.from(
    new Set(
      visibleEvents
        .map((event) => event.patient_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [signals, patients] = await Promise.all([
    eventIds.length > 0
      ? prisma.inboundCommunicationSignal.findMany({
          where: {
            org_id: args.ctx.orgId,
            inbound_event_id: { in: eventIds },
          },
          orderBy: [{ inbound_event_id: 'asc' }, { signal_index: 'asc' }],
          select: {
            id: true,
            inbound_event_id: true,
            signal_domain: true,
            signal_type: true,
            extracted_text: true,
            extracted_medication_name: true,
            extracted_quantity: true,
            extracted_unit: true,
            review_status: true,
            action_status: true,
            source_confidence: true,
          },
        })
      : [],
    patientIds.length > 0
      ? prisma.patient.findMany({
          where: { org_id: args.ctx.orgId, id: { in: patientIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));
  const signalsByEventId = new Map<string, typeof signals>();
  for (const signal of signals) {
    const current = signalsByEventId.get(signal.inbound_event_id) ?? [];
    current.push(signal);
    signalsByEventId.set(signal.inbound_event_id, current);
  }

  const inboundItems: CockpitInboundItem[] = visibleEvents.map((event) => {
    const eventSignals = signalsByEventId.get(event.id) ?? [];
    const status = deriveInboundStatus({
      processingStatus: event.processing_status,
      signals: eventSignals,
    });
    const priority = deriveInboundPriority({
      hasPatientSafetySignal: event.has_patient_safety_signal,
      hasMedicationStockSignal: event.has_medication_stock_signal,
      status,
      signals: eventSignals,
    });
    const channel = String(event.source_channel);
    const channelLabel = INBOUND_CHANNEL_LABELS[channel] ?? '受信';
    return {
      id: `inbound_communication:${event.id}`,
      event_id: event.id,
      channel,
      channel_label: channelLabel,
      event_type: String(event.event_type),
      processing_status: String(event.processing_status),
      status,
      priority,
      patient_id: event.patient_id,
      patient_name: event.patient_id ? (patientNameById.get(event.patient_id) ?? null) : null,
      sender_name: event.sender_name,
      sender_role: String(event.sender_role),
      sender_organization_name: event.sender_organization_name,
      sender_contact: event.sender_contact,
      title: buildInboundTitle({
        channelLabel,
        hasMedicationStockSignal: event.has_medication_stock_signal,
        hasPatientSafetySignal: event.has_patient_safety_signal,
      }),
      summary: event.normalized_summary ?? event.raw_text,
      raw_text: event.raw_text,
      normalized_summary: event.normalized_summary,
      received_at: event.received_at.toISOString(),
      occurred_at: event.occurred_at?.toISOString() ?? null,
      due_at: event.received_at.toISOString(),
      attachment_count: event.attachment_count,
      has_medication_stock_signal: event.has_medication_stock_signal,
      has_patient_safety_signal: event.has_patient_safety_signal,
      has_schedule_signal: event.has_schedule_signal,
      has_report_signal: event.has_report_signal,
      signals: eventSignals.map((signal) => ({
        id: signal.id,
        signal_domain: String(signal.signal_domain),
        signal_type: String(signal.signal_type),
        extracted_text: signal.extracted_text,
        extracted_medication_name: signal.extracted_medication_name,
        extracted_quantity: signal.extracted_quantity,
        extracted_unit: signal.extracted_unit,
        review_status: String(signal.review_status),
        action_status: String(signal.action_status),
        source_confidence: String(signal.source_confidence),
      })),
      action_href: buildInboundCommunicationHref(event),
      action_label: status === 'needs_review' ? '受信情報を確認' : '処理状況を開く',
    };
  });

  return {
    ...args.scopeContext.metadata,
    inbound_items: inboundItems,
    inbound_total_count: totalCount,
    inbound_visible_count: inboundItems.length,
    inbound_hidden_count: Math.max(totalCount - inboundItems.length, 0),
    inbound_needs_review_count: inboundItems.filter((item) => item.status === 'needs_review')
      .length,
    inbound_reviewed_pending_action_count: inboundItems.filter(
      (item) => item.status === 'reviewed_pending_action',
    ).length,
    inbound_urgent_count: inboundItems.filter((item) => item.priority === 'urgent').length,
    inbound_medication_stock_signal_count: inboundItems.filter(
      (item) => item.has_medication_stock_signal,
    ).length,
    inbound_safety_signal_count: inboundItems.filter((item) => item.has_patient_safety_signal)
      .length,
  };
}

async function readDashboardMedicationStockUrgents(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardMedicationStockUrgentResult> {
  const baseWhere = buildDashboardMedicationStockSignalWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
  });
  const where: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [
      baseWhere,
      { review_status: { in: ['accepted', 'auto_accepted'] } },
      { action_status: { in: ['not_linked', 'linked_to_task'] } },
    ],
  };

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const [signals, totalCount] = await Promise.all([
        tx.inboundCommunicationSignal.findMany({
          where,
          orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
          take: MEDICATION_STOCK_RISK_FETCH_LIMIT,
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            inbound_event_id: true,
            signal_type: true,
            extracted_text: true,
            extracted_medication_name: true,
            extracted_quantity: true,
            extracted_unit: true,
            source_confidence: true,
            review_status: true,
            action_status: true,
            created_at: true,
            updated_at: true,
            inbound_event: {
              select: {
                id: true,
                patient_id: true,
                case_id: true,
                source_channel: true,
                sender_role: true,
                normalized_summary: true,
                received_at: true,
              },
            },
          },
        }),
        tx.inboundCommunicationSignal.count({ where }),
      ]);

      const actionableSignals = signals.filter(
        (signal) =>
          ['accepted', 'auto_accepted'].includes(signal.review_status) &&
          ['not_linked', 'linked_to_task'].includes(signal.action_status),
      );
      const visibleSignals = actionableSignals.slice(0, MEDICATION_STOCK_RISK_RESPONSE_LIMIT);
      const patientIds = Array.from(
        new Set(
          visibleSignals
            .map((signal) => signal.patient_id ?? signal.inbound_event.patient_id)
            .filter((patientId): patientId is string => Boolean(patientId)),
        ),
      );
      const patients =
        patientIds.length > 0
          ? await tx.patient.findMany({
              where: { org_id: args.ctx.orgId, id: { in: patientIds } },
              select: { id: true, name: true },
            })
          : [];
      const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));
      const urgentItems = visibleSignals
        .map((signal) =>
          buildMedicationStockRiskItem({
            signal,
            patientName: signal.patient_id
              ? (patientNameById.get(signal.patient_id) ?? null)
              : signal.inbound_event.patient_id
                ? (patientNameById.get(signal.inbound_event.patient_id) ?? null)
                : null,
          }),
        )
        .map(buildMedicationStockUrgentItem)
        .filter((item): item is DashboardUrgentItem => item != null);

      return { items: urgentItems, totalCount };
    },
    { requestContext: args.ctx, maxWaitMs: 2000, timeoutMs: 3000 },
  );
}

async function readDashboardMedicationStockRisks(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCockpitMedicationStockResponse> {
  const where = buildDashboardMedicationStockSignalWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
  });
  const urgentWhere: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [
      where,
      {
        OR: [
          { signal_type: 'out_of_stock_text' },
          { signal_type: 'observed_quantity', extracted_quantity: 0 },
        ],
      },
    ],
  };
  const shortageWhere: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [where, { signal_type: { in: ['low_stock_text', 'refill_request'] } }],
  };
  const usageWhere: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [where, { signal_type: { in: ['usage_frequency', 'usage_delta'] } }],
  };
  const equivalenceWhere: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [
      where,
      {
        OR: [{ extracted_medication_name: null }, { extracted_medication_name: '' }],
      },
    ],
  };
  const linkedWhere: Prisma.InboundCommunicationSignalWhereInput = {
    AND: [where, { action_status: 'linked_to_stock_event' }],
  };

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const [
        signals,
        totalCount,
        urgentShortageCount,
        shortageExpectedCount,
        usageUnknownCount,
        equivalenceReviewCount,
        linkedToStockEventCount,
      ] = await Promise.all([
        tx.inboundCommunicationSignal.findMany({
          where,
          orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
          take: MEDICATION_STOCK_RISK_FETCH_LIMIT,
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            inbound_event_id: true,
            signal_type: true,
            extracted_text: true,
            extracted_medication_name: true,
            extracted_quantity: true,
            extracted_unit: true,
            source_confidence: true,
            review_status: true,
            action_status: true,
            created_at: true,
            updated_at: true,
            inbound_event: {
              select: {
                id: true,
                patient_id: true,
                case_id: true,
                source_channel: true,
                sender_role: true,
                normalized_summary: true,
                received_at: true,
              },
            },
          },
        }),
        tx.inboundCommunicationSignal.count({ where }),
        tx.inboundCommunicationSignal.count({ where: urgentWhere }),
        tx.inboundCommunicationSignal.count({ where: shortageWhere }),
        tx.inboundCommunicationSignal.count({ where: usageWhere }),
        tx.inboundCommunicationSignal.count({ where: equivalenceWhere }),
        tx.inboundCommunicationSignal.count({ where: linkedWhere }),
      ]);

      const visibleSignals = signals.slice(0, MEDICATION_STOCK_RISK_RESPONSE_LIMIT);
      const patientIds = Array.from(
        new Set(
          visibleSignals
            .map((signal) => signal.patient_id ?? signal.inbound_event.patient_id)
            .filter((patientId): patientId is string => Boolean(patientId)),
        ),
      );
      const patients =
        patientIds.length > 0
          ? await tx.patient.findMany({
              where: { org_id: args.ctx.orgId, id: { in: patientIds } },
              select: { id: true, name: true },
            })
          : [];
      const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

      const stockItems = visibleSignals
        .map((signal) =>
          buildMedicationStockRiskItem({
            signal,
            patientName: signal.patient_id
              ? (patientNameById.get(signal.patient_id) ?? null)
              : signal.inbound_event.patient_id
                ? (patientNameById.get(signal.inbound_event.patient_id) ?? null)
                : null,
          }),
        )
        .sort((left, right) => {
          const riskWeight: Record<DashboardMedicationStockRiskItem['risk_level'], number> = {
            urgent: 0,
            shortage_expected: 1,
            usage_unknown: 2,
            review_required: 3,
            linked: 4,
          };
          const weightDiff = riskWeight[left.risk_level] - riskWeight[right.risk_level];
          if (weightDiff !== 0) return weightDiff;
          return right.updated_at.localeCompare(left.updated_at);
        });

      return {
        ...args.scopeContext.metadata,
        stock_summary: {
          urgent_shortage_count: urgentShortageCount,
          shortage_expected_count: shortageExpectedCount,
          usage_unknown_count: usageUnknownCount,
          equivalence_review_count: equivalenceReviewCount,
          inbound_stock_signal_count: totalCount,
          linked_to_stock_event_count: linkedToStockEventCount,
        },
        stock_items: stockItems,
        stock_items_total_count: totalCount,
        stock_items_visible_count: stockItems.length,
        stock_items_hidden_count: Math.max(totalCount - stockItems.length, 0),
      };
    },
    { requestContext: args.ctx, maxWaitMs: 2000, timeoutMs: 3000 },
  );
}

async function readDashboardCallbackUrgents(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCallbackUrgentResult> {
  const where = buildDashboardCallbackWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
  });
  const [logs, totalCount] = await Promise.all([
    prisma.visitScheduleContactLog.findMany({
      where,
      orderBy: [{ callback_due_at: 'asc' }, { called_at: 'desc' }, { id: 'asc' }],
      take: CALLBACK_URGENT_FETCH_LIMIT,
      select: {
        id: true,
        patient_id: true,
        schedule_id: true,
        outcome: true,
        contact_name: true,
        note: true,
        callback_due_at: true,
        called_at: true,
      },
    }),
    prisma.visitScheduleContactLog.count({ where }),
  ]);
  const patientIds = Array.from(new Set(logs.map((log) => log.patient_id)));
  const patients =
    patientIds.length > 0
      ? await prisma.patient.findMany({
          where: { org_id: args.ctx.orgId, id: { in: patientIds } },
          select: { id: true, name: true },
        })
      : [];
  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

  return {
    totalCount,
    items: logs.map((log) =>
      buildCallbackUrgentItem({
        log,
        patientName: patientNameById.get(log.patient_id) ?? null,
        now: args.scopeContext.now,
      }),
    ),
  };
}

async function readDashboardReportDeliveryUrgents(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardReportUrgentResult> {
  const where = buildDashboardReportDeliveryWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
  });
  const [deliveries, totalCount] = await Promise.all([
    prisma.deliveryRecord.findMany({
      where,
      orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      take: REPORT_URGENT_FETCH_LIMIT,
      select: {
        id: true,
        channel: true,
        recipient_name: true,
        failure_reason: true,
        retry_count: true,
        updated_at: true,
        report: {
          select: {
            id: true,
            patient_id: true,
            report_type: true,
          },
        },
      },
    }),
    prisma.deliveryRecord.count({ where }),
  ]);
  const patientIds = Array.from(new Set(deliveries.map((delivery) => delivery.report.patient_id)));
  const patients =
    patientIds.length > 0
      ? await prisma.patient.findMany({
          where: { org_id: args.ctx.orgId, id: { in: patientIds } },
          select: { id: true, name: true },
        })
      : [];
  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

  return {
    totalCount,
    items: deliveries.map((delivery) =>
      buildReportDeliveryUrgentItem({
        delivery,
        patientName: patientNameById.get(delivery.report.patient_id) ?? null,
      }),
    ),
  };
}

async function readDashboardBillingUrgents(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardBillingUrgentResult> {
  if (!hasPermission(args.ctx.role, 'canManageBilling')) {
    return { items: [], totalCount: 0 };
  }

  const billingMonth = billingMonthForJapanTimestamp(args.scopeContext.now);
  const where = buildDashboardBillingCandidateWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    billingMonth,
  });

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const [candidates, totalCount] = await Promise.all([
        tx.billingCandidate.findMany({
          where,
          orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
          take: BILLING_URGENT_FETCH_LIMIT,
          select: {
            id: true,
            patient_id: true,
            billing_month: true,
            billing_code: true,
            billing_name: true,
            updated_at: true,
          },
        }),
        tx.billingCandidate.count({ where }),
      ]);
      const patientIds = Array.from(
        new Set(
          candidates
            .map((candidate) => candidate.patient_id)
            .filter((patientId): patientId is string => Boolean(patientId)),
        ),
      );
      const patients =
        patientIds.length > 0
          ? await tx.patient.findMany({
              where: { org_id: args.ctx.orgId, id: { in: patientIds } },
              select: { id: true, name: true },
            })
          : [];
      const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

      return {
        totalCount,
        items: candidates.map((candidate) =>
          buildBillingUrgentItem({
            candidate,
            patientName: candidate.patient_id
              ? (patientNameById.get(candidate.patient_id) ?? null)
              : null,
          }),
        ),
      };
    },
    { requestContext: args.ctx, maxWaitMs: 2000, timeoutMs: 3000 },
  );
}

async function readDashboardVisitPreparationUrgents(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardVisitPreparationUrgentResult> {
  const hasRestrictedScope =
    args.scopeContext.assignmentScope.caseIds !== undefined ||
    args.scopeContext.assignmentScope.patientIds !== undefined;
  const hasScopeTargets =
    (args.scopeContext.assignmentScope.caseIds?.length ?? 0) > 0 ||
    (args.scopeContext.assignmentScope.patientIds?.length ?? 0) > 0;
  if (hasRestrictedScope && !hasScopeTargets) {
    return { items: [], totalCount: 0 };
  }

  const where = buildDashboardVisitPreparationWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    todayRange: args.scopeContext.todayRange,
  });

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const [schedules, totalCount] = await Promise.all([
        tx.visitSchedule.findMany({
          where,
          orderBy: [
            { scheduled_date: 'asc' },
            { time_window_start: 'asc' },
            { route_order: 'asc' },
            { id: 'asc' },
          ],
          take: VISIT_PREPARATION_URGENT_FETCH_LIMIT,
          select: {
            id: true,
            display_id: true,
            visit_type: true,
            priority: true,
            schedule_status: true,
            scheduled_date: true,
            time_window_start: true,
            carry_items_status: true,
            pre_visit_checklist_completed: true,
            updated_at: true,
            preparation: {
              select: {
                id: true,
                org_id: true,
                prepared_at: true,
                updated_at: true,
                medication_changes_reviewed: true,
                carry_items_confirmed: true,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
              },
            },
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
        tx.visitSchedule.count({ where }),
      ]);

      return {
        totalCount,
        items: schedules
          .map((schedule) =>
            buildVisitPreparationUrgentItem({
              schedule,
              orgId: args.ctx.orgId,
              now: args.scopeContext.now,
            }),
          )
          .filter((item): item is DashboardUrgentItem => item != null),
      };
    },
    { requestContext: args.ctx, maxWaitMs: 2000, timeoutMs: 3000 },
  );
}

async function readDashboardReportBilling(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCockpitReportBillingResponse> {
  const billingMonth = billingMonthForJapanTimestamp(args.scopeContext.now);
  const draftReportWhere = buildDashboardCareReportWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    status: ReportStatus.draft,
  });
  const deliveryAttentionWhere = buildDashboardReportDeliveryStatusWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    statuses: [ReportStatus.failed, ReportStatus.response_waiting],
  });
  const failedDeliveryWhere = buildDashboardReportDeliveryStatusWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    statuses: [ReportStatus.failed],
  });
  const waitingDeliveryWhere = buildDashboardReportDeliveryStatusWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    statuses: [ReportStatus.response_waiting],
  });
  const canReadBilling = hasPermission(args.ctx.role, 'canManageBilling');
  const billingWhere = buildDashboardBillingCandidateWhere({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    billingMonth,
  });

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const [
        draftReports,
        deliveryRecords,
        billingCandidates,
        draftNeededCount,
        deliveryFailedCount,
        waitingConfirmationCount,
        billingCandidateCount,
      ] = await Promise.all([
        tx.careReport.findMany({
          where: draftReportWhere,
          orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
          take: REPORT_BILLING_ITEM_RESPONSE_LIMIT,
          select: {
            id: true,
            patient_id: true,
            report_type: true,
            status: true,
            updated_at: true,
          },
        }),
        tx.deliveryRecord.findMany({
          where: deliveryAttentionWhere,
          orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
          take: REPORT_BILLING_ITEM_RESPONSE_LIMIT,
          select: {
            id: true,
            channel: true,
            recipient_name: true,
            failure_reason: true,
            status: true,
            retry_count: true,
            updated_at: true,
            report: {
              select: {
                id: true,
                patient_id: true,
                report_type: true,
              },
            },
          },
        }),
        canReadBilling
          ? tx.billingCandidate.findMany({
              where: billingWhere,
              orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
              take: REPORT_BILLING_ITEM_RESPONSE_LIMIT,
              select: {
                id: true,
                patient_id: true,
                billing_month: true,
                billing_code: true,
                billing_name: true,
                updated_at: true,
              },
            })
          : [],
        tx.careReport.count({ where: draftReportWhere }),
        tx.deliveryRecord.count({ where: failedDeliveryWhere }),
        tx.deliveryRecord.count({ where: waitingDeliveryWhere }),
        canReadBilling ? tx.billingCandidate.count({ where: billingWhere }) : 0,
      ]);

      const patientIds = Array.from(
        new Set(
          [
            ...draftReports.map((report) => report.patient_id),
            ...deliveryRecords.map((delivery) => delivery.report.patient_id),
            ...billingCandidates
              .map((candidate) => candidate.patient_id)
              .filter((patientId): patientId is string => Boolean(patientId)),
          ].filter((patientId): patientId is string => Boolean(patientId)),
        ),
      );
      const patients =
        patientIds.length > 0
          ? await tx.patient.findMany({
              where: { org_id: args.ctx.orgId, id: { in: patientIds } },
              select: { id: true, name: true },
            })
          : [];
      const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

      const items = [
        ...draftReports.map((report) =>
          buildReportDraftBillingItem({
            report,
            patientName: patientNameById.get(report.patient_id) ?? null,
          }),
        ),
        ...deliveryRecords.map((delivery) =>
          buildReportDeliveryBillingItem({
            delivery,
            patientName: patientNameById.get(delivery.report.patient_id) ?? null,
          }),
        ),
        ...billingCandidates.map((candidate) =>
          buildBillingCandidateReportBillingItem({
            candidate,
            patientName: candidate.patient_id
              ? (patientNameById.get(candidate.patient_id) ?? null)
              : null,
          }),
        ),
      ]
        .sort(compareReportBillingItems)
        .slice(0, REPORT_BILLING_ITEM_RESPONSE_LIMIT);
      const totalCount =
        draftNeededCount + deliveryFailedCount + waitingConfirmationCount + billingCandidateCount;
      const isMonthEndWindow = args.scopeContext.now.getDate() >= 25;

      return {
        ...args.scopeContext.metadata,
        reports: {
          draft_needed_count: draftNeededCount,
          delivery_failed_count: deliveryFailedCount,
          waiting_confirmation_count: waitingConfirmationCount,
        },
        billing: {
          blocker_count: billingCandidateCount,
          close_queue_count: billingCandidateCount,
          month_end_risk_count: isMonthEndWindow ? billingCandidateCount : 0,
          can_view_billing: canReadBilling,
        },
        items,
        items_total_count: totalCount,
        items_visible_count: items.length,
        items_hidden_count: Math.max(totalCount - items.length, 0),
      };
    },
    { requestContext: args.ctx, maxWaitMs: 2000, timeoutMs: 3000 },
  );
}

async function readDashboardComments(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCockpitCommentsResponse> {
  const rawComments = await prisma.taskComment.findMany({
    where: { org_id: args.ctx.orgId },
    orderBy: { created_at: 'desc' },
    take: COMMENT_FEED_FETCH_LIMIT,
    select: {
      id: true,
      entity_type: true,
      entity_id: true,
      content: true,
      author_id: true,
      mentions: true,
      created_at: true,
    },
  });
  const candidates: DashboardCommentCandidate[] = rawComments
    .filter((comment): comment is DashboardCommentCandidate =>
      isDashboardCommentEntityType(comment.entity_type),
    )
    .map((comment) => ({
      id: comment.id,
      entity_type: comment.entity_type,
      entity_id: comment.entity_id,
      content: comment.content,
      author_id: comment.author_id,
      mentions: comment.mentions,
      created_at: comment.created_at,
    }));

  const entityIds = createEntityIdBucket();
  for (const comment of candidates) {
    entityIds[comment.entity_type].add(comment.entity_id);
  }

  const { allowed, cyclePatientIds } = await readAllowedCommentEntities({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    entityIds,
  });

  const visibleCandidates = candidates.filter((comment) =>
    allowed[comment.entity_type].has(comment.entity_id),
  );
  const visible = visibleCandidates.slice(0, COMMENT_FEED_RESPONSE_LIMIT);
  const authorIds = Array.from(new Set(visible.map((comment) => comment.author_id)));
  const authors =
    authorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: authorIds }, org_id: args.ctx.orgId },
          select: { id: true, name: true },
        });
  const authorMap = new Map(authors.map((author) => [author.id, author.name]));

  return {
    ...args.scopeContext.metadata,
    comments: visible.map((comment) => ({
      id: comment.id,
      entity_type: comment.entity_type,
      entity_id: comment.entity_id,
      entity_label: DASHBOARD_COMMENT_ENTITY_LABELS[comment.entity_type],
      author_id: comment.author_id,
      author_name: authorMap.get(comment.author_id) ?? '不明',
      content_excerpt: normalizeCommentExcerpt(comment.content),
      mentions_me: comment.mentions.includes(args.ctx.userId),
      authored_by_me: comment.author_id === args.ctx.userId,
      created_at: comment.created_at.toISOString(),
      href: buildDashboardCommentHref(comment, cyclePatientIds),
    })),
    comments_total_count: visibleCandidates.length,
    comments_visible_count: visible.length,
    comments_hidden_count: Math.max(visibleCandidates.length - visible.length, 0),
  };
}

async function buildCockpitSummary(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitSummaryResponse> {
  const [cycleStatusCounts, auditSummary, todayVisitSummary] = await Promise.all([
    readCycleStatusCounts({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readAuditQueueSummary({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readTodayVisitSummary({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
  ]);

  return {
    ...scopeContext.metadata,
    cycle_status_counts: cycleStatusCounts,
    audit_pending_count: auditSummary.totalCount,
    audit_queue_total_count: auditSummary.totalCount,
    narcotic_audit_count: auditSummary.narcoticCount,
    earliest_audit_due_at: auditSummary.earliestDueAt,
    today_visit_count: todayVisitSummary.count,
    today_visit_times: todayVisitSummary.times,
  };
}

async function buildCockpitDetails(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitDetailsResponse> {
  const [
    auditQueue,
    inbound,
    medicationStockUrgents,
    visitPreparationUrgents,
    callbackUrgents,
    reportUrgents,
    billingUrgents,
    todaySchedules,
    openExceptions,
    carryoverCount,
  ] = await Promise.all([
    readAuditQueue({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readDashboardInbound({ ctx, scopeContext }),
    readDashboardMedicationStockUrgents({ ctx, scopeContext }),
    readDashboardVisitPreparationUrgents({ ctx, scopeContext }),
    readDashboardCallbackUrgents({ ctx, scopeContext }),
    readDashboardReportDeliveryUrgents({ ctx, scopeContext }),
    readDashboardBillingUrgents({ ctx, scopeContext }),
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: ctx.orgId,
        status: 'open',
        ...(scopeContext.assignmentScope.caseIds
          ? {
              OR: [
                { cycle_id: null },
                { cycle: { case_id: { in: scopeContext.assignmentScope.caseIds } } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: 'asc' },
      take: BLOCKED_REASONS_LIMIT,
      select: {
        id: true,
        exception_type: true,
        patient_id: true,
        description: true,
        severity: true,
        created_at: true,
      },
    }),
    prisma.task.count({
      where: {
        org_id: ctx.orgId,
        status: { in: ['pending', 'in_progress'] },
        created_at: { lt: scopeContext.todayInstantStart },
        ...buildDashboardTaskAssignmentWhere(scopeContext.assignmentScope),
      },
    }),
  ]);

  const visibleQueue = auditQueue.all.slice(0, AUDIT_QUEUE_RESPONSE_LIMIT);
  const blockedReasons = buildBlockedReasons(
    openExceptions,
    scopeContext.now,
  ) as CockpitBlockedReason[];
  const urgentItems = buildDashboardUrgentItems({
    auditItems: visibleQueue,
    inboundItems: inbound.inbound_items,
    medicationStockItems: medicationStockUrgents.items,
    visitPreparationItems: visitPreparationUrgents.items,
    callbackItems: callbackUrgents.items,
    reportItems: reportUrgents.items,
    billingItems: billingUrgents.items,
    blockedReasons,
    now: scopeContext.now,
  });
  const urgentSourceCount =
    auditQueue.totalCount +
    inbound.inbound_needs_review_count +
    medicationStockUrgents.totalCount +
    visitPreparationUrgents.totalCount +
    callbackUrgents.totalCount +
    reportUrgents.totalCount +
    billingUrgents.totalCount +
    blockedReasons.length;
  return {
    ...scopeContext.metadata,
    audit_queue_total_count: auditQueue.totalCount,
    audit_queue_visible_count: visibleQueue.length,
    audit_queue_hidden_count: Math.max(auditQueue.totalCount - visibleQueue.length, 0),
    audit_queue: visibleQueue,
    urgent_items: urgentItems,
    urgent_total_count: urgentSourceCount,
    urgent_visible_count: urgentItems.length,
    urgent_hidden_count: Math.max(urgentSourceCount - urgentItems.length, 0),
    today_visits: mapTodayVisits(todaySchedules),
    blocked_reasons: blockedReasons,
    carryover_count: carryoverCount,
  };
}

async function buildCockpitTeam(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitTeamResponse> {
  const [todaySchedules, teamMembers, todayShifts] = await Promise.all([
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        user: { is_active: true },
      },
      orderBy: { created_at: 'asc' },
      select: {
        user_id: true,
        role: true,
        user: { select: { name: true } },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        date: scopeContext.todayRange,
      },
      select: {
        user_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    }),
  ]);

  return {
    ...scopeContext.metadata,
    team_capacity: buildTeamCapacity(teamMembers, todayShifts, todaySchedules, scopeContext.now),
  };
}

async function buildCockpitFull(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitResponse> {
  const [
    cycleStatusCounts,
    auditQueue,
    todaySchedules,
    openExceptions,
    carryoverCount,
    teamMembers,
    todayShifts,
  ] = await Promise.all([
    readCycleStatusCounts({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readAuditQueue({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: ctx.orgId,
        status: 'open',
        ...(scopeContext.assignmentScope.caseIds
          ? {
              OR: [
                { cycle_id: null },
                { cycle: { case_id: { in: scopeContext.assignmentScope.caseIds } } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: 'asc' },
      take: BLOCKED_REASONS_LIMIT,
      select: {
        id: true,
        exception_type: true,
        patient_id: true,
        description: true,
        severity: true,
        created_at: true,
      },
    }),
    prisma.task.count({
      where: {
        org_id: ctx.orgId,
        status: { in: ['pending', 'in_progress'] },
        created_at: { lt: scopeContext.todayInstantStart },
        ...buildDashboardTaskAssignmentWhere(scopeContext.assignmentScope),
      },
    }),
    prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        user: { is_active: true },
      },
      orderBy: { created_at: 'asc' },
      select: {
        user_id: true,
        role: true,
        user: { select: { name: true } },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        date: scopeContext.todayRange,
      },
      select: {
        user_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    }),
  ]);
  const visibleQueue = auditQueue.all.slice(0, AUDIT_QUEUE_RESPONSE_LIMIT);

  return {
    ...scopeContext.metadata,
    cycle_status_counts: cycleStatusCounts,
    audit_pending_count: auditQueue.totalCount,
    audit_queue_total_count: auditQueue.totalCount,
    audit_queue_visible_count: visibleQueue.length,
    audit_queue_hidden_count: Math.max(auditQueue.totalCount - visibleQueue.length, 0),
    narcotic_audit_count: auditQueue.all.filter((item) => item.has_narcotic).length,
    audit_queue: visibleQueue,
    today_visits: mapTodayVisits(todaySchedules),
    blocked_reasons: buildBlockedReasons(
      openExceptions,
      scopeContext.now,
    ) as CockpitBlockedReason[],
    carryover_count: carryoverCount,
    team_capacity: buildTeamCapacity(teamMembers, todayShifts, todaySchedules, scopeContext.now),
  };
}

async function buildCockpitSegment(args: {
  ctx: AuthContext;
  requestedScope: DashboardCockpitScope | null;
  part: DashboardCockpitPart;
}): Promise<DashboardCockpitSegmentResponse> {
  const scopeContext = await resolveCockpitScopeContext({
    ctx: args.ctx,
    requestedScope: args.requestedScope,
    part: args.part,
  });
  if (args.part === 'comments') {
    return readDashboardComments({ ctx: args.ctx, scopeContext });
  }
  if (args.part === 'inbound') {
    return readDashboardInbound({ ctx: args.ctx, scopeContext });
  }
  if (args.part === 'stock-risks') {
    return readDashboardMedicationStockRisks({ ctx: args.ctx, scopeContext });
  }
  if (args.part === 'report-billing') {
    return readDashboardReportBilling({ ctx: args.ctx, scopeContext });
  }

  const cachedData = serverCache.get<DashboardCockpitSegmentResponse>(scopeContext.cacheKey);
  if (cachedData) return cachedData;

  const data =
    args.part === 'summary'
      ? await buildCockpitSummary(args.ctx, scopeContext)
      : args.part === 'details'
        ? await buildCockpitDetails(args.ctx, scopeContext)
        : args.part === 'team'
          ? await buildCockpitTeam(args.ctx, scopeContext)
          : await buildCockpitFull(args.ctx, scopeContext);

  serverCache.set(scopeContext.cacheKey, data, COCKPIT_CACHE_TTL_MS);
  return data;
}

export async function dashboardCockpitSegmentResponse(
  req: NextRequest,
  part: DashboardCockpitPart,
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const scopeQuery = parseDashboardScope(req);
    if (!scopeQuery.ok) return scopeQuery.response;

    const data = await buildCockpitSegment({
      ctx,
      requestedScope: scopeQuery.scope,
      part,
    });
    return success({ data });
  });
}
