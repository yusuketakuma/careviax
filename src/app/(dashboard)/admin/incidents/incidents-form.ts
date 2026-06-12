import type { IncidentRelatedProcess } from '@/lib/validations/incident-report';

/**
 * p1_09「ヒヤリハット管理」: API レコード ⇔ 再発防止メモフォームの射影。
 * すべて純関数(incidents-form.test.ts で検証)。
 */

/** 関係する工程の選択肢(DB はコード、表示は日本語ラベル) */
export const INCIDENT_PROCESS_OPTIONS = [
  { value: 'intake', label: '取込' },
  { value: 'entry', label: '入力' },
  { value: 'judgment', label: '判断' },
  { value: 'dispensing', label: '調剤' },
  { value: 'audit', label: '監査' },
  { value: 'set', label: 'セット' },
  { value: 'visit', label: '訪問' },
  { value: 'report', label: '報告' },
  { value: 'billing', label: '算定' },
] as const satisfies ReadonlyArray<{ value: IncidentRelatedProcess; label: string }>;

export type IncidentReportListItem = {
  id: string;
  title: string;
  what_happened: string | null;
  cause: string | null;
  immediate_action: string | null;
  prevention_plan: string | null;
  related_process: string | null;
  severity: string;
  status: string;
  occurred_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 再発防止メモフォーム(未入力は空文字で保持する) */
export type IncidentMemoForm = {
  whatHappened: string;
  cause: string;
  immediateAction: string;
  preventionPlan: string;
  relatedProcess: string; // '' = 未選択
};

export const EMPTY_INCIDENT_MEMO_FORM: IncidentMemoForm = {
  whatHappened: '',
  cause: '',
  immediateAction: '',
  preventionPlan: '',
  relatedProcess: '',
};

function isKnownProcess(value: string): value is IncidentRelatedProcess {
  return INCIDENT_PROCESS_OPTIONS.some((option) => option.value === value);
}

/** API レコードからフォーム状態へ射影する(null → 空文字) */
export function toIncidentMemoForm(report: IncidentReportListItem | null): IncidentMemoForm {
  if (!report) return { ...EMPTY_INCIDENT_MEMO_FORM };
  return {
    whatHappened: report.what_happened ?? '',
    cause: report.cause ?? '',
    immediateAction: report.immediate_action ?? '',
    preventionPlan: report.prevention_plan ?? '',
    relatedProcess:
      report.related_process && isKnownProcess(report.related_process)
        ? report.related_process
        : '',
  };
}

export type IncidentMemoPatchPayload = {
  what_happened: string | null;
  cause: string | null;
  immediate_action: string | null;
  prevention_plan: string | null;
  related_process: IncidentRelatedProcess | null;
};

/** フォーム状態から PATCH ペイロードへ変換する(trim、空文字 → null) */
export function buildIncidentMemoPatchPayload(form: IncidentMemoForm): IncidentMemoPatchPayload {
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    what_happened: normalize(form.whatHappened),
    cause: normalize(form.cause),
    immediate_action: normalize(form.immediateAction),
    prevention_plan: normalize(form.preventionPlan),
    related_process: isKnownProcess(form.relatedProcess) ? form.relatedProcess : null,
  };
}

/** 再発防止メモが1項目でも記入済みか */
export function hasPreventionMemo(report: IncidentReportListItem): boolean {
  return [
    report.what_happened,
    report.cause,
    report.immediate_action,
    report.prevention_plan,
    report.related_process,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

/** 記録カードのサブテキスト(未記入なら「再発防止を記録」) */
export function incidentCardSubtext(report: IncidentReportListItem): string {
  return hasPreventionMemo(report) ? '再発防止メモあり' : '再発防止を記録';
}
