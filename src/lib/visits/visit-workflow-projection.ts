import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildVisitRecordHref } from '@/lib/visits/navigation';

export type VisitWorkflowConferenceNoteType = 'pre_discharge' | 'service_manager';

export type VisitWorkflowConferenceContext = {
  id: string;
  note_type: VisitWorkflowConferenceNoteType;
  title: string;
  conference_date: string;
  highlights?: string[];
  action_items?: string[];
  sync_summary?: {
    billing_candidate_id?: string | null;
    visit_proposal_id?: string | null;
    report_draft_ids?: string[];
  } | null;
};

export type VisitWorkflowActionPriority = 'urgent' | 'high' | 'normal';
export type VisitWorkflowActionStatus = 'ready' | 'needs_review' | 'waiting' | 'blocked';
export type VisitWorkflowActionPlacement = 'primary' | 'secondary';
export type VisitWorkflowActionOperation =
  | 'generate_report'
  | 'open_report'
  | 'edit_visit_record'
  | 'review_share'
  | 'generate_billing_candidates'
  | 'open_billing_candidates'
  | 'review_billing_blockers'
  | 'create_next_visit'
  | 'edit_next_visit_suggestion'
  | 'open_conference';

export type VisitWorkflowActionButton = {
  operation: VisitWorkflowActionOperation;
  label: string;
  href?: string;
  variant?: 'default' | 'outline';
};

export type VisitWorkflowActionDetail = {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
};

export type VisitWorkflowReportSummary = {
  id: string;
  report_type: string;
  status: string;
  latest_delivery_status?: string | null;
  latest_delivery_recipient_name?: string | null;
};

export type VisitWorkflowBillingBlockerSummary = {
  reason: string;
  severity?: 'info' | 'warning' | 'critical' | 'urgent' | 'high' | 'normal';
  action_href?: string | null;
  action_label?: string | null;
};

export type VisitWorkflowAction = {
  key: 'report' | 'care_team_share' | 'billing_review' | 'next_visit' | 'conference_followup';
  title: string;
  description: string;
  priority: VisitWorkflowActionPriority;
  status: VisitWorkflowActionStatus;
  placement: VisitWorkflowActionPlacement;
  primary_action: VisitWorkflowActionButton;
  secondary_action?: VisitWorkflowActionButton;
  details?: VisitWorkflowActionDetail[];
  href?: string;
  action_label?: string;
  evidence: string[];
};

function isVisitWorkflowActionDetail(
  detail: VisitWorkflowActionDetail | null,
): detail is VisitWorkflowActionDetail {
  return detail !== null;
}

function compactVisitWorkflowActionDetails(
  details: Array<VisitWorkflowActionDetail | null>,
): VisitWorkflowActionDetail[] {
  return details.filter(isVisitWorkflowActionDetail);
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildVisitBillingCandidatesHref(args: {
  billingMonth?: string | null;
  patientId: string;
  recordId: string;
  scheduleId?: string | null;
}) {
  return `/billing/candidates?${new URLSearchParams({
    ...(args.billingMonth ? { billing_month: args.billingMonth } : {}),
    patient_id: args.patientId,
    workflow_from: 'visit_record',
    visit_record_id: args.recordId,
    ...(args.scheduleId ? { schedule_id: args.scheduleId } : {}),
  }).toString()}`;
}

function buildPatientCollaborationHref(patientId: string) {
  return buildPatientHref(patientId, '/collaboration');
}

function buildVisitConferenceHref(patientId: string) {
  return `/conferences?${new URLSearchParams({ patient_id: patientId }).toString()}`;
}

export function getConferenceTypeLabel(type: string | null | undefined) {
  if (type === 'pre_discharge') return '退院前カンファ';
  if (type === 'service_manager') return '担当者会議';
  return '会議';
}

export function extractConferenceProposalOrigin(reason: string | null | undefined) {
  if (!reason) return null;
  if (reason.includes('conference-visit-proposal')) {
    return {
      label: '会議由来',
      description: '退院前カンファ・担当者会議から次回訪問候補へ接続されています。',
    };
  }
  if (reason.includes('conference-recurrence-proposal')) {
    return {
      label: '会議後の継続訪問',
      description: '会議で決まったフォローを定期訪問の提案へ接続しています。',
    };
  }
  return null;
}

export function buildConferenceReportLines(notes: VisitWorkflowConferenceContext[]) {
  return notes.flatMap((note) => {
    const prefix = `${getConferenceTypeLabel(note.note_type)}: ${note.title}`;
    const highlights = (note.highlights ?? []).slice(0, 3).map((item) => `${prefix} / ${item}`);
    const actions = (note.action_items ?? [])
      .slice(0, 3)
      .map((item) => `${prefix} / 合意事項: ${item}`);
    return [...highlights, ...actions];
  });
}

export function buildPostVisitWorkflowActions(args: {
  recordId: string;
  scheduleId?: string | null;
  patientId: string;
  soapComplete: boolean;
  collaborationMentioned: boolean;
  medicationManagementComplete: boolean;
  missingMedicationManagementLabels?: string[];
  billingBlockerCount: number;
  billingBlockers?: VisitWorkflowBillingBlockerSummary[];
  billingCandidateCount?: number;
  billingCandidatesLoading?: boolean;
  billingCandidatesError?: boolean;
  billingMonth?: string | null;
  careTeamContactCount: number;
  hasNextVisitSuggestion: boolean;
  nextVisitSuggestionDate?: string | null;
  reports?: VisitWorkflowReportSummary[];
  reportsError?: boolean;
  conferenceContext?: VisitWorkflowConferenceContext[];
}): VisitWorkflowAction[] {
  const conferenceNotes = args.conferenceContext ?? [];
  const reports = args.reports ?? [];
  const billingBlockers = args.billingBlockers ?? [];
  const preferredReport =
    reports.find((report) => report.report_type === 'physician_report') ?? reports[0] ?? null;
  const firstBillingBlocker = billingBlockers[0];
  const billingCandidatesLoading = args.billingCandidatesLoading === true;
  const billingCandidateCount = args.billingCandidateCount ?? 0;
  // 取得失敗時は件数(0)・下書き有無が不正確になりうるため、generate 系の破壊的アクション
  // (報告書/請求候補の新規生成)を露出しない。安全な確認導線へ切り替え、上部の再読み込みに誘導する。
  const reportsError = args.reportsError === true;
  const billingError = args.billingCandidatesError === true;
  const conferenceActionCount = conferenceNotes.reduce(
    (count, note) => count + (note.action_items?.length ?? 0),
    0,
  );
  const conferenceEvidence = conferenceNotes
    .slice(0, 2)
    .map((note) => `${getConferenceTypeLabel(note.note_type)}: ${note.title}`);
  const preferredReportHref = preferredReport ? buildReportHref(preferredReport.id) : undefined;
  const preferredReportShareHref = preferredReport
    ? buildReportHref(preferredReport.id, '/share')
    : undefined;
  const visitRecordHref = args.scheduleId ? buildVisitRecordHref(args.scheduleId) : undefined;
  const patientCollaborationHref = buildPatientCollaborationHref(args.patientId);
  const careTeamShareHref = preferredReportShareHref ?? patientCollaborationHref;
  const visitBillingCandidatesHref = buildVisitBillingCandidatesHref({
    billingMonth: args.billingMonth,
    patientId: args.patientId,
    recordId: args.recordId,
    scheduleId: args.scheduleId,
  });
  const visitConferenceHref = buildVisitConferenceHref(args.patientId);

  return [
    {
      key: 'report',
      title: '報告書作成',
      description: reportsError
        ? '報告書の取得に失敗しました。上部の「再読み込み」で再取得してから作成を判断してください（未取得のまま新規作成すると重複のおそれ）。'
        : reports.length > 0
          ? '訪問記録から作成済みの報告書を確認し、送付は報告書画面で判断します。'
          : args.soapComplete
            ? 'SOAP と訪問薬剤管理の要点から医師・ケアマネ向け文書を作れます。'
            : 'SOAP の不足を閉じると報告書の自動生成精度が上がります。',
      priority: args.soapComplete ? 'normal' : 'high',
      status: reportsError
        ? 'needs_review'
        : reports.length > 0 || args.soapComplete
          ? 'ready'
          : 'needs_review',
      placement: 'primary',
      // 取得失敗時は generate_report / open_report(下書き有無が不確定)を出さず、記録確認の安全導線のみ。
      primary_action: reportsError
        ? {
            operation: 'edit_visit_record',
            label: '記録を確認',
            href: visitRecordHref,
          }
        : preferredReport
          ? {
              operation: 'open_report',
              label: '報告書を確認',
              href: preferredReportHref,
            }
          : args.soapComplete
            ? { operation: 'generate_report', label: '報告書を作成' }
            : {
                operation: 'edit_visit_record',
                label: '記録を追記',
                href: visitRecordHref,
              },
      secondary_action:
        !reportsError && preferredReport && args.soapComplete
          ? { operation: 'generate_report', label: '別文書を作成', variant: 'outline' }
          : undefined,
      details: compactVisitWorkflowActionDetails([
        reportsError
          ? {
              label: '報告書',
              value: '取得失敗',
              tone: 'warning',
            }
          : null,
        !reportsError && reports.length > 0
          ? {
              label: '作成済み',
              value: `${reports.length}件`,
              tone: 'success',
            }
          : null,
        !reportsError && preferredReport?.latest_delivery_status
          ? {
              label: '送付状態',
              value: preferredReport.latest_delivery_recipient_name
                ? `${preferredReport.latest_delivery_status} / ${preferredReport.latest_delivery_recipient_name}`
                : preferredReport.latest_delivery_status,
              tone: 'info',
            }
          : null,
      ]),
      href: reportsError ? visitRecordHref : preferredReportHref,
      action_label: reportsError
        ? '記録を確認'
        : preferredReport
          ? '報告書を確認'
          : args.soapComplete
            ? '報告書を作成'
            : '記録を追記',
      evidence: [
        reportsError ? '報告書の取得に失敗（件数・下書きは不確定）' : null,
        !reportsError && reports.length > 0 ? `作成済み報告書 ${reports.length}件` : null,
        args.soapComplete ? 'SOAP本文あり' : 'SOAP本文に不足あり',
        args.medicationManagementComplete
          ? '訪問薬剤管理の確認済み'
          : `訪問薬剤管理の不足: ${(args.missingMedicationManagementLabels ?? [])
              .slice(0, 3)
              .join(' / ')}`,
      ].filter((item): item is string => hasText(item)),
    },
    {
      key: 'care_team_share',
      title: '他職種共有',
      description: args.collaborationMentioned
        ? 'P に連携事項があるため、報告書と共有先を同じ流れで確認します。'
        : '医師・ケアマネへ渡す論点を P に明記すると共有が自然につながります。',
      priority: conferenceActionCount > 0 ? 'high' : 'normal',
      status: args.careTeamContactCount > 0 ? 'ready' : 'needs_review',
      placement: 'secondary',
      primary_action: {
        operation: 'review_share',
        label: '共有先を確認',
        href: careTeamShareHref,
      },
      href: careTeamShareHref,
      action_label: '連携を確認',
      evidence: [
        args.careTeamContactCount > 0 ? `共有先 ${args.careTeamContactCount}件` : '共有先未登録',
        ...conferenceEvidence,
      ],
    },
    {
      key: 'billing_review',
      title: '算定レビュー',
      description:
        args.billingBlockerCount > 0
          ? '算定を止めている理由を先に閉じると候補レビューの差戻しを減らせます。'
          : billingError
            ? '請求候補の取得に失敗しました。候補件数が不確定のため、生成はせず月次レビュー画面で実際の候補を確認してください。'
            : billingCandidatesLoading
              ? 'この患者の請求候補を確認しています。読み込み完了後に月次レビューへ進めます。'
              : billingCandidateCount > 0
                ? 'この患者の請求候補を月次レビュー画面で確認します。確定・除外は月次画面で行います。'
                : '算定を止めている理由は目立っていません。候補生成後に月次締めへ進めます。',
      priority: args.billingBlockerCount > 0 ? 'high' : 'normal',
      status:
        args.billingBlockerCount > 0
          ? 'blocked'
          : billingError
            ? 'needs_review'
            : billingCandidatesLoading
              ? 'waiting'
              : 'ready',
      placement: 'primary',
      // 取得失敗時は generate_billing_candidates(候補0前提の生成)を出さず、確認画面への非破壊導線のみ。
      primary_action:
        args.billingBlockerCount > 0
          ? {
              operation: 'review_billing_blockers',
              label: firstBillingBlocker?.action_label ?? '止まっている理由を確認',
              href: firstBillingBlocker?.action_href ?? visitRecordHref,
            }
          : billingError
            ? {
                operation: 'open_billing_candidates',
                label: '請求候補を確認',
                href: visitBillingCandidatesHref,
                variant: 'outline',
              }
            : billingCandidatesLoading
              ? {
                  operation: 'open_billing_candidates',
                  label: '請求候補を確認中',
                  href: visitBillingCandidatesHref,
                  variant: 'outline',
                }
              : billingCandidateCount > 0
                ? {
                    operation: 'open_billing_candidates',
                    label: '請求候補を確認',
                    href: visitBillingCandidatesHref,
                  }
                : { operation: 'generate_billing_candidates', label: '請求候補を生成' },
      details: compactVisitWorkflowActionDetails([
        args.billingMonth
          ? { label: '対象月', value: args.billingMonth.slice(0, 7), tone: 'neutral' }
          : null,
        billingError
          ? {
              label: '候補',
              value: '取得失敗',
              tone: 'warning',
            }
          : null,
        !billingError && billingCandidatesLoading
          ? {
              label: '候補',
              value: '確認中',
              tone: 'info',
            }
          : null,
        !billingError && billingCandidateCount > 0
          ? {
              label: '候補',
              value: `${billingCandidateCount}件`,
              tone: 'success',
            }
          : null,
      ]),
      href:
        args.billingBlockerCount > 0
          ? (firstBillingBlocker?.action_href ?? visitRecordHref)
          : visitBillingCandidatesHref,
      action_label:
        args.billingBlockerCount > 0
          ? (firstBillingBlocker?.action_label ?? '止まっている理由を確認')
          : billingError
            ? '請求候補を確認'
            : billingCandidatesLoading
              ? '請求候補を確認中'
              : billingCandidateCount > 0
                ? '請求候補を確認'
                : '請求候補を生成',
      evidence:
        args.billingBlockerCount > 0
          ? [`止まっている理由 ${args.billingBlockerCount}件`]
          : billingError
            ? ['請求候補の取得に失敗（件数は不確定）']
            : billingCandidatesLoading
              ? ['請求候補を読み込み中']
              : ['2026要件を候補生成へ連携'],
    },
    {
      key: 'next_visit',
      title: '次回訪問',
      description: args.hasNextVisitSuggestion
        ? '訪問記録の提案日をそのまま次回予定として作成できます。'
        : '必要なフォロー時期を P または次回提案日に残します。',
      priority: args.hasNextVisitSuggestion ? 'normal' : 'high',
      status: args.hasNextVisitSuggestion ? 'ready' : 'waiting',
      placement: 'primary',
      primary_action: args.hasNextVisitSuggestion
        ? { operation: 'create_next_visit', label: '次回予定を作成' }
        : {
            operation: 'edit_next_visit_suggestion',
            label: '提案日を入力',
            href: visitRecordHref ?? '/schedules',
          },
      details: args.nextVisitSuggestionDate
        ? [{ label: '提案日', value: args.nextVisitSuggestionDate.slice(0, 10), tone: 'info' }]
        : [],
      href: visitRecordHref ?? '/schedules',
      action_label: args.hasNextVisitSuggestion ? '次回予定を作成' : '提案日を入力',
      evidence: args.hasNextVisitSuggestion
        ? [
            `次回提案日あり${args.nextVisitSuggestionDate ? `: ${args.nextVisitSuggestionDate.slice(0, 10)}` : ''}`,
          ]
        : ['次回提案日未入力'],
    },
    {
      key: 'conference_followup',
      title: '会議アクション回収',
      description:
        conferenceActionCount > 0
          ? '退院前カンファ・担当者会議の合意事項を訪問後の確認に残します。'
          : '会議由来の未回収アクションはありません。',
      priority: conferenceActionCount > 0 ? 'high' : 'normal',
      status: conferenceActionCount > 0 ? 'needs_review' : 'ready',
      placement: 'secondary',
      primary_action: {
        operation: 'open_conference',
        label: '会議を確認',
        href: visitConferenceHref,
      },
      href: visitConferenceHref,
      action_label: '会議を確認',
      evidence:
        conferenceActionCount > 0
          ? [`合意事項 ${conferenceActionCount}件`, ...conferenceEvidence]
          : ['会議引き継ぎなし'],
    },
  ];
}
