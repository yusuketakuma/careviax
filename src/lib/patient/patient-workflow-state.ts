import {
  PROCESS_STEPS_9,
  type CycleWorkspaceAction,
  type ProcessStepKey,
} from '@/lib/prescription/cycle-workspace';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { getWorkflowExceptionStatusText } from '@/lib/workflow/blocked-reason-projection';
import type { PatientAttentionKey, PatientStatusTone } from '@/types/patient-board';

export type PatientWorkflowLink = {
  label: string;
  href: string;
};

export type PatientWorkflowStateInput = {
  patientId: string;
  hasCareCase: boolean;
  careCaseStatus: string | null;
  currentStep: ProcessStepKey | null;
  cycleOverallStatus: string | null;
  cycleExceptionStatus: string | null;
  cycleUpdatedAt: Date | null;
  hospitalized: boolean;
  auditWaiting: boolean;
  hasNarcotic: boolean;
  auditDueDate: Date | null;
  inquiryResolvedAt: Date | null;
  inquiryInquiredAt: Date | null;
  visitToday: boolean;
  visitPreparationReady: boolean;
  nextScheduleId: string | null;
  pendingReportId: string | null;
  openExceptionType: string | null;
  now: Date;
};

export type PatientWorkflowState = {
  attention: PatientAttentionKey;
  statusText: string;
  statusTone: PatientStatusTone;
  currentStep: ProcessStepKey | null;
  link: PatientWorkflowLink | null;
  nextVisitLabel: string | null;
};

/** Current step -> shortcut used by patient board cards. */
export const PATIENT_WORKFLOW_STEP_LINKS: Record<ProcessStepKey, PatientWorkflowLink> = {
  intake: { label: '取込へ', href: '/prescriptions' },
  entry: { label: '入力へ', href: '/prescriptions' },
  decision: { label: 'カードへ', href: '' },
  dispense: { label: '調剤へ', href: '/dispense' },
  audit: { label: '監査へ', href: '/audit' },
  set: { label: 'セットへ', href: '/set' },
  visit: { label: '訪問へ', href: '/visits' },
  report: { label: '報告・共有へ', href: '/reports' },
  billing: { label: '算定チェックへ', href: '/billing' },
};

/** Natural language for steady state patient cards. */
const STEADY_STATUS_TEXT: Record<ProcessStepKey, string> = {
  intake: '処方の取込待ち',
  entry: '処方の入力中',
  decision: '処方内容の判断中',
  dispense: '調剤中(通常レーン)',
  audit: '調剤監査の順番待ち',
  set: 'セット作成中(通常レーン)',
  visit: '訪問準備が整っています',
  report: '報告書 作成待ち',
  billing: '報告済み — 算定チェック待ち',
};

const TOKYO_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60_000)));
}

function formatTokyoTimeOfDay(value: Date): string {
  const parts = TOKYO_TIME_FORMATTER.formatToParts(value);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!hour || !minute) return '—';
  return `${hour}:${minute}`;
}

export function getPatientWorkflowStepLabel(step: ProcessStepKey | null): string | null {
  if (!step) return null;
  return PROCESS_STEPS_9.find((candidate) => candidate.key === step)?.label ?? null;
}

export function buildPatientWorkflowProcessLabel(args: {
  currentStep: ProcessStepKey | null;
  cycleAction: CycleWorkspaceAction | null;
}): string | null {
  const currentStepLabel = getPatientWorkflowStepLabel(args.currentStep);
  if (currentStepLabel) return `工程: ${currentStepLabel}(いまここ)`;
  if (args.cycleAction) return `工程: ${args.cycleAction.statusLabel}`;
  return null;
}

export function derivePatientWorkflowState(input: PatientWorkflowStateInput): PatientWorkflowState {
  let attention: PatientAttentionKey;
  let statusText: string;
  let statusTone: PatientStatusTone;
  let link = input.currentStep ? PATIENT_WORKFLOW_STEP_LINKS[input.currentStep] : null;
  let nextVisitLabel: string | null = null;

  if (input.hospitalized) {
    attention = 'paused';
    statusText = '入院中 — 退院時共同指導の対象';
    statusTone = 'neutral';
    link = PATIENT_WORKFLOW_STEP_LINKS.billing;
    nextVisitLabel = '退院連絡待ち';
  } else if (
    input.hasCareCase &&
    input.careCaseStatus != null &&
    ['referral_received', 'assessment'].includes(input.careCaseStatus)
  ) {
    attention = 'acceptance';
    statusText = '受入の返答待ち — 訪問枠を調整中';
    statusTone = 'caution';
    link = {
      label: 'スケジュールへ',
      href: input.nextScheduleId ? buildScheduleFocusHref(input.nextScheduleId) : '/schedules',
    };
    if (!input.nextScheduleId) nextVisitLabel = '未定(調整中)';
  } else if (
    !input.hasCareCase ||
    input.careCaseStatus === 'on_hold' ||
    input.cycleOverallStatus === 'on_hold'
  ) {
    attention = 'paused';
    statusText = '休止中 — 再開の判断待ち';
    statusTone = 'neutral';
    link = null;
  } else if (input.auditWaiting && (input.hasNarcotic || input.auditDueDate != null)) {
    attention = 'urgent_now';
    const dueLabel = input.auditDueDate ? ` 期限${formatTokyoTimeOfDay(input.auditDueDate)}` : '';
    statusText = input.hasNarcotic
      ? `麻薬監査${dueLabel} — 持参薬が未確定`
      : `調剤監査${dueLabel} — 完了で次工程が動きます`;
    statusTone = 'critical';
    link = PATIENT_WORKFLOW_STEP_LINKS.audit;
  } else if (input.cycleOverallStatus === 'inquiry_resolved') {
    attention = 'wait_release';
    statusText = input.inquiryResolvedAt
      ? `照会回答が届きました(${formatTokyoTimeOfDay(input.inquiryResolvedAt)}) — 調剤を再開できます`
      : '照会回答が届きました — 調剤を再開できます';
    statusTone = 'positive';
    link = PATIENT_WORKFLOW_STEP_LINKS.dispense;
  } else if (input.visitToday) {
    attention = 'visit_today';
    statusText = input.visitPreparationReady
      ? '準備完了 — パケット・ルート・セット✓'
      : '本日訪問 — 出発前チェックを確認';
    statusTone = 'info';
    link = {
      ...PATIENT_WORKFLOW_STEP_LINKS.visit,
      href: input.nextScheduleId
        ? buildScheduleFocusHref(input.nextScheduleId)
        : PATIENT_WORKFLOW_STEP_LINKS.visit.href,
    };
  } else if (input.cycleOverallStatus === 'inquiry_pending') {
    attention = 'external_wait';
    const waitingDays = input.inquiryInquiredAt
      ? daysBetween(input.inquiryInquiredAt, input.now)
      : 0;
    statusText =
      waitingDays > 0
        ? `医師回答待ち ${waitingDays}日 — 再照会を検討`
        : '医師回答待ち — 本日照会済み';
    statusTone = 'external';
    link = null;
  } else if (
    input.cycleOverallStatus != null &&
    ['awaiting_reply', 'report_failed'].includes(input.cycleExceptionStatus ?? '')
  ) {
    attention = 'reply_wait';
    const waitingDays = input.cycleUpdatedAt ? daysBetween(input.cycleUpdatedAt, input.now) : 0;
    statusText =
      waitingDays > 0
        ? `報告先の返信待ち ${waitingDays}日 — 再送できます`
        : '報告先の返信待ち — 再送できます';
    statusTone = 'external';
    link = input.pendingReportId
      ? { ...PATIENT_WORKFLOW_STEP_LINKS.report, href: buildReportHref(input.pendingReportId) }
      : PATIENT_WORKFLOW_STEP_LINKS.report;
  } else if (input.openExceptionType) {
    attention = 'checking';
    statusText = getWorkflowExceptionStatusText(input.openExceptionType);
    statusTone = 'caution';
  } else {
    attention = 'steady';
    statusText = input.currentStep
      ? STEADY_STATUS_TEXT[input.currentStep]
      : '進行中の処方サイクルはありません';
    statusTone = 'neutral';
  }

  if (input.nextScheduleId && link?.href === PATIENT_WORKFLOW_STEP_LINKS.visit.href) {
    link = { ...link, href: buildScheduleFocusHref(input.nextScheduleId) };
  }

  return {
    attention,
    statusText,
    statusTone,
    currentStep: attention === 'paused' || attention === 'acceptance' ? null : input.currentStep,
    link,
    nextVisitLabel,
  };
}
