import { buildPatientHref } from '@/lib/patient/navigation';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import type {
  PatientHomeOperationItem,
  PatientHomeOperationKey,
} from '@/types/patient-home-operations';
import type { PatientOverview } from './patient-detail.types';

const HOME_OPS_METRIC_LIMIT = 4;

const HOME_OPS_METRIC_PRIORITIES: Partial<Record<PatientHomeOperationKey, string[]>> = {
  documents: ['PDF/画像', '回収/画像', '最終印刷', '契約書'],
  mcs: ['最終確認', '参加状況', '主な連携先', '同期状態'],
  prescription: ['期限', '原本', '照合', '疑義照会'],
  billing: ['未収額', '次回集金予定', '支払者', '領収証'],
  conference: ['報告書', 'フォロー', '議題', '場所'],
};

export function getPrimaryHomeVisitIntake(patient: PatientOverview) {
  const intakeCase =
    patient.cases.find((careCase) => getHomeVisitIntake(careCase.required_visit_support)) ?? null;
  return intakeCase ? getHomeVisitIntake(intakeCase.required_visit_support) : null;
}

export function selectHomeOperationMetrics(item: PatientHomeOperationItem) {
  const priority = HOME_OPS_METRIC_PRIORITIES[item.key] ?? [];
  const selected: PatientHomeOperationItem['metrics'] = [];
  const seen = new Set<string>();

  for (const label of priority) {
    const metric = item.metrics.find((candidate) => candidate.label === label);
    if (metric && !seen.has(metric.label)) {
      selected.push(metric);
      seen.add(metric.label);
    }
  }

  for (const metric of item.metrics) {
    if (selected.length >= HOME_OPS_METRIC_LIMIT) break;
    if (!seen.has(metric.label)) {
      selected.push(metric);
      seen.add(metric.label);
    }
  }

  return selected.slice(0, HOME_OPS_METRIC_LIMIT);
}

export function buildHomeOperationsItems(patient: PatientOverview): PatientHomeOperationItem[] {
  const activeCase =
    patient.cases.find((careCase) => careCase.status === 'active') ?? patient.cases[0] ?? null;
  const intake = getPrimaryHomeVisitIntake(patient);
  const hasDocumentNote = Boolean(intake?.document_status_note?.trim());
  const mcsLinked = patient.scheduling_preference?.mcs_linked === true;
  const hasPrescription = Boolean(patient.workspace?.current_intake);
  const hasConferenceContext = Boolean(patient.visit_brief?.conference_summary);
  const hasBillingSupport = patient.billing_support_flag;

  return [
    {
      key: 'documents',
      label: '契約・同意・書類',
      status: hasDocumentNote ? '書類メモあり' : '要確認',
      description: hasDocumentNote
        ? (intake?.document_status_note ?? '契約書類の状態を確認できます。')
        : '契約書、重要事項説明書、同意書、初回訪問文書の作成・交付・回収状況を確認します。',
      href: buildPatientHref(patient.id, '#patient-documents'),
      action_label: '文書状態へ',
      tone: hasDocumentNote ? 'ok' : 'attention',
      updated_at: null,
      metrics: [],
      alerts: hasDocumentNote ? [] : ['書類状態を確認してください'],
    },
    {
      key: 'mcs',
      label: 'MCS・外部連携',
      status: mcsLinked ? '連携あり' : '未確認',
      description: mcsLinked
        ? 'MCS連携ページでURL、同期状況、共有要点、次アクションを確認します。'
        : '患者別MCS URLの登録、最終確認日、外部連携ログの確認導線です。',
      href: buildPatientHref(patient.id, '/mcs'),
      action_label: mcsLinked ? 'MCS連携を管理' : 'MCSを登録',
      tone: mcsLinked ? 'ok' : 'neutral',
      updated_at: null,
      metrics: [],
      alerts: [],
    },
    {
      key: 'prescription',
      label: '処方せん',
      status: hasPrescription ? '受付あり' : '未受付',
      description: hasPrescription
        ? '処方受付、原本、電子処方せん、疑義照会、服薬管理への流れを確認します。'
        : 'FAX先行、原本到着、電子処方せん、照合・保管状況の受付が必要です。',
      href: buildPatientHref(patient.id, '/prescriptions'),
      action_label: '処方履歴へ',
      tone: hasPrescription ? 'ok' : 'attention',
      updated_at: null,
      metrics: [],
      alerts: hasPrescription ? [] : ['処方せん受付がまだありません'],
    },
    {
      key: 'billing',
      label: '請求・集金',
      status: hasBillingSupport ? '支援対象' : '未設定',
      description: hasBillingSupport
        ? '算定候補、請求ブロック、未収・集金確認タスクを患者単位で追います。'
        : '支払者、支払方法、未収許容、領収証・請求書の運用を確認します。',
      href: `/billing/candidates?${new URLSearchParams({ patient_id: patient.id }).toString()}`,
      action_label: '請求候補を確認',
      tone: hasBillingSupport ? 'ok' : 'neutral',
      updated_at: null,
      metrics: [],
      alerts: [],
    },
    {
      key: 'conference',
      label: 'カンファレンス',
      status: hasConferenceContext ? '共有要点あり' : '未登録',
      description: hasConferenceContext
        ? '退院前カンファ、担当者会議、報告書作成、会議後タスクを訪問準備に接続します。'
        : '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を登録します。',
      href: `/conferences?${new URLSearchParams({
        patient_id: patient.id,
        ...(activeCase ? { case_id: activeCase.id } : {}),
        focus: 'notes',
        context: 'patient_detail',
      }).toString()}`,
      action_label: hasConferenceContext ? '会議要点へ' : '会議を登録',
      tone: hasConferenceContext ? 'ok' : 'attention',
      updated_at: null,
      metrics: [],
      alerts: hasConferenceContext ? [] : ['カンファレンス記録が未登録です'],
    },
  ];
}
