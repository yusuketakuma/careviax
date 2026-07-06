import { format, formatDistanceToNowStrict, isSameDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  PROCESS_STEPS_9,
  type CycleWorkspaceAction,
  type ProcessStepKey,
  getCycleWorkspaceAction,
  getProcessStepIndex,
  getProcessStepKeyForStatus,
} from '@/lib/prescription/cycle-workspace';
import type { VisitBriefUnresolvedItem } from '@/types/visit-brief';
import type { CaseRiskCockpitResponse, CaseRiskNextAction } from '@/types/case-risk-cockpit';
import type { PatientOverview, PatientWorkspace } from './patient-detail.types';

type CommandCenterPatient = Pick<PatientOverview, 'id' | 'lab_summary' | 'visit_brief'>;

export type PatientCommandNextAction = {
  description?: string;
  actionLabel: string;
  actionHref?: string;
};

export type PatientCommandBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  categoryLabel?: string;
  ageLabel?: string;
  actionLabel?: string;
  actionHref?: string;
};

export type PatientCommandEvidenceItem = {
  id: string;
  label: string;
  meta?: string;
  href: string;
};

export type PatientCommandCaseRiskSummary = {
  status: CaseRiskCockpitResponse['overall']['status'];
  statusLabel: string;
  blockingCount: number;
  urgentCount: number;
  warningCount: number;
};

export type PatientCommandCaseRiskAction = {
  id: string;
  taskId: string | null;
  label: string;
  priority: CaseRiskNextAction['priority'];
  dueAt: string | null;
  actionHref: string;
};

export type PatientCommandCenterModel = {
  currentStep: ProcessStepKey | null;
  currentStepLabel: string | null;
  cycleAction: CycleWorkspaceAction | null;
  processLabel: string | null;
  nextAction?: PatientCommandNextAction;
  blockedReasons: PatientCommandBlockedReason[];
  evidence: PatientCommandEvidenceItem[];
  caseRiskSummary: PatientCommandCaseRiskSummary | null;
  caseRiskActions: PatientCommandCaseRiskAction[];
};

type BuildPatientCommandCenterModelInput = {
  patient: CommandCenterPatient;
  patientId: string;
  workspace: PatientWorkspace;
  caseRiskCockpit?: CaseRiskCockpitForCommand | null;
};

type CaseRiskCockpitForCommand = Pick<CaseRiskCockpitResponse, 'overall' | 'next_actions'>;

/** 止まっている理由: WorkflowException type → カテゴリ色チップ(患者/事務/医療機関) */
const EXCEPTION_CATEGORY_LABELS: Record<string, string> = {
  no_show: '患者',
  hospitalized: '患者',
  refused_receipt: '患者',
  discontinued_collection_unconfirmed: '患者',
  family_consent_pending: '患者',
  awaiting_reply: '医療機関',
  prescription_structuring_block: '事務',
  outpatient_injection_eligibility_block: '事務',
  delivery_target_confirmation: '事務',
  report_failed: '事務',
};

/** 止まっている理由: type 別の個別アクション(06_card 右レール「再連絡する→」等) */
const EXCEPTION_ACTIONS: Record<string, { label: string; href: string }> = {
  family_consent_pending: { label: '再連絡する', href: '/communications/requests' },
  delivery_target_confirmation: { label: '状況を見る', href: '/admin/contact-profiles' },
};

const UNRESOLVED_CATEGORY_LABELS: Record<VisitBriefUnresolvedItem['source_type'], string> = {
  task: '事務',
  issue: '患者',
  inquiry: '医療機関',
  billing: '事務',
};

/** 当日は HH:mm、それ以外は M/d 表示(06_card 直近の動きの時刻表記) */
export function formatActivityTime(value: string): string {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return value;
  return isSameDay(date, new Date()) ? format(date, 'HH:mm') : format(date, 'M/d', { locale: ja });
}

/** 経過時間ラベル(「1日」「30分」)。解釈できない値は undefined。 */
function formatAgeLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatDistanceToNowStrict(date, { locale: ja });
}

function resolveExceptionAction(exceptionType: string, patientId: string) {
  const action = EXCEPTION_ACTIONS[exceptionType];
  if (exceptionType === 'family_consent_pending' || exceptionType === 'awaiting_reply') {
    return {
      label: action?.label ?? '再連絡する',
      href: buildCommunicationRequestsHref({ status: 'sent', patientId }),
    };
  }
  return action ?? { label: '状況を見る', href: '/workflow' };
}

function caseRiskStatusLabel(status: CaseRiskCockpitResponse['overall']['status']) {
  if (status === 'blocked') return '停止中';
  if (status === 'attention') return '要確認';
  return '準備完了';
}

export function buildCaseRiskCommandPanelModel(
  caseRiskCockpit?: CaseRiskCockpitForCommand | null,
): Pick<PatientCommandCenterModel, 'caseRiskSummary' | 'caseRiskActions'> {
  if (!caseRiskCockpit) {
    return {
      caseRiskSummary: null,
      caseRiskActions: [],
    };
  }

  return {
    caseRiskSummary: {
      status: caseRiskCockpit.overall.status,
      statusLabel: caseRiskStatusLabel(caseRiskCockpit.overall.status),
      blockingCount: caseRiskCockpit.overall.blocking_count,
      urgentCount: caseRiskCockpit.overall.urgent_count,
      warningCount: caseRiskCockpit.overall.warning_count,
    },
    caseRiskActions: caseRiskCockpit.next_actions.slice(0, 4).map((action, index) => ({
      id: action.task_id ?? `${action.priority}:${index}:${action.action_href}`,
      taskId: action.task_id ?? null,
      label: action.label,
      priority: action.priority,
      dueAt: action.due_at,
      actionHref: action.action_href,
    })),
  };
}

export function buildPatientCommandCenterModel({
  patient,
  patientId,
  workspace,
  caseRiskCockpit,
}: BuildPatientCommandCenterModelInput): PatientCommandCenterModel {
  const currentStep = getProcessStepKeyForStatus(workspace.overall_status);
  const currentStepLabel =
    currentStep != null ? (PROCESS_STEPS_9[getProcessStepIndex(currentStep)]?.label ?? null) : null;
  const cycleAction = getCycleWorkspaceAction(workspace.overall_status, {
    patientId: workspace.action_context.patient_id ?? patientId,
    prescriptionIntakeId:
      workspace.action_context.prescription_intake_id ?? workspace.current_intake?.id,
    visitScheduleId: workspace.action_context.visit_schedule_id,
    visitRecordId: workspace.action_context.visit_record_id,
    reportId: workspace.action_context.report_id,
  });
  const processLabel = currentStepLabel
    ? `工程: ${currentStepLabel}(いまここ)`
    : cycleAction
      ? `工程: ${cycleAction.statusLabel}`
      : null;

  const deadlineTask = workspace.today_tasks.find((task) => task.due_time != null) ?? null;
  const nextAction = cycleAction
    ? {
        description: cycleAction.description,
        actionLabel: deadlineTask?.due_time
          ? `${cycleAction.actionLabel} — ${deadlineTask.due_time}期限`
          : cycleAction.actionLabel,
        actionHref: cycleAction.actionHref,
      }
    : undefined;

  const unresolved = patient.visit_brief?.unresolved_items ?? [];
  const blockedReasons: PatientCommandBlockedReason[] = [
    ...workspace.open_exceptions.map((exception) => {
      const action = resolveExceptionAction(exception.exception_type, patient.id);
      return {
        id: exception.id,
        label: exception.description,
        severity: exception.severity,
        categoryLabel: EXCEPTION_CATEGORY_LABELS[exception.exception_type] ?? '事務',
        ageLabel: formatAgeLabel(exception.created_at),
        actionLabel: `${action.label} →`,
        actionHref: action.href,
      };
    }),
    ...unresolved.map((item, index) => ({
      id: `${item.source_type}-${index}`,
      label: item.title,
      severity: (item.severity === 'urgent' || item.severity === 'high'
        ? 'critical'
        : 'warning') as PatientCommandBlockedReason['severity'],
      categoryLabel: UNRESOLVED_CATEGORY_LABELS[item.source_type],
      actionLabel: '状況を見る →',
      actionHref: item.href,
    })),
  ];

  const latestInquiryActivity =
    workspace.recent_activities.find((activity) => activity.type === 'inquiry') ?? null;
  const hasEgfr = patient.lab_summary.some((lab) => lab.analyte_code === 'egfr');
  const intakeDateLabel = workspace.current_intake
    ? formatActivityTime(workspace.current_intake.prescribed_date)
    : undefined;
  const evidence: PatientCommandEvidenceItem[] = [
    ...(workspace.prescription_document_url
      ? [
          {
            id: 'prescription-image',
            label: '処方せん画像',
            meta: intakeDateLabel,
            href: workspace.prescription_document_url,
          },
        ]
      : []),
    {
      id: 'medication-notebook',
      label: 'お薬手帳(最新)',
      href: buildPatientHref(patientId, '#patient-profile-summary'),
    },
    ...(latestInquiryActivity
      ? [
          {
            id: 'inquiry-response',
            label: '照会回答',
            meta: formatActivityTime(latestInquiryActivity.at),
            href: latestInquiryActivity.href,
          },
        ]
      : []),
    {
      id: 'lab-trend',
      label: '検査値の推移',
      meta: hasEgfr ? 'eGFR' : undefined,
      href: buildPatientHref(patientId, '#patient-profile-summary'),
    },
  ];

  return {
    currentStep,
    currentStepLabel,
    cycleAction,
    processLabel,
    nextAction,
    blockedReasons,
    evidence,
    ...buildCaseRiskCommandPanelModel(caseRiskCockpit),
  };
}
