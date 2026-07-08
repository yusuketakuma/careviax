import { format, formatDistanceToNowStrict, isSameDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  type CycleWorkspaceAction,
  type ProcessStepKey,
  getCycleWorkspaceAction,
  getProcessStepKeyForStatus,
} from '@/lib/prescription/cycle-workspace';
import {
  buildPatientWorkflowProcessLabel,
  getPatientWorkflowStepLabel,
} from '@/lib/patient/patient-workflow-state';
import type { VisitBriefUnresolvedItem } from '@/types/visit-brief';
import type { CaseRiskCockpitResponse, CaseRiskNextAction } from '@/types/case-risk-cockpit';
import {
  getWorkflowExceptionStatusText,
  resolveBlockedReasonActionHref,
  resolveBlockedReasonPresentation,
} from '@/lib/workflow/blocked-reason-projection';
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

export type PatientCommandRecentActivityItem = {
  id: string;
  type: PatientWorkspace['recent_activities'][number]['type'];
  label: string;
  meta: string;
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
  recentActivities: PatientCommandRecentActivityItem[];
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

const UNRESOLVED_CATEGORY_LABELS: Record<VisitBriefUnresolvedItem['source_type'], string> = {
  task: '事務',
  issue: '患者',
  inquiry: '医療機関',
  billing: '事務',
  medication_stock: '残数',
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
  const currentStepLabel = getPatientWorkflowStepLabel(currentStep);
  const cycleAction = getCycleWorkspaceAction(workspace.overall_status, {
    patientId: workspace.action_context.patient_id ?? patientId,
    prescriptionIntakeId:
      workspace.action_context.prescription_intake_id ?? workspace.current_intake?.id,
    visitScheduleId: workspace.action_context.visit_schedule_id,
    visitRecordId: workspace.action_context.visit_record_id,
    reportId: workspace.action_context.report_id,
  });
  const processLabel = buildPatientWorkflowProcessLabel({ currentStep, cycleAction });

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
      const presentation = resolveBlockedReasonPresentation(exception.exception_type);
      return {
        id: exception.id,
        label: getWorkflowExceptionStatusText(exception.exception_type),
        severity: exception.severity,
        categoryLabel: presentation.category,
        ageLabel: formatAgeLabel(exception.created_at),
        actionLabel: presentation.actionLabel,
        actionHref: resolveBlockedReasonActionHref(exception.exception_type, patient.id),
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
  const recentActivities: PatientCommandRecentActivityItem[] = workspace.recent_activities
    .slice(0, 3)
    .map((activity) => ({
      id: activity.id,
      type: activity.type,
      label: activity.actor ? `${activity.label} — ${activity.actor}` : activity.label,
      meta: formatActivityTime(activity.at),
      href: activity.href,
    }));

  return {
    currentStep,
    currentStepLabel,
    cycleAction,
    processLabel,
    nextAction,
    blockedReasons,
    evidence,
    recentActivities,
    ...buildCaseRiskCommandPanelModel(caseRiskCockpit),
  };
}
