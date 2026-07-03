import type {
  IncidentRelatedProcess,
  IncidentSeverity,
  IncidentStatus,
} from '@/lib/validations/incident-report';
import type { StatusRole } from '@/lib/constants/status-tokens';

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

/** ステータス語彙(未対応/確認済み/クローズ)。ステータス変更は管理者のみ(サーバ側 canAdmin ガード)。 */
export const INCIDENT_STATUS_OPTIONS = [
  { value: 'open', label: '未対応' },
  { value: 'reviewed', label: '確認済み' },
  { value: 'closed', label: 'クローズ' },
] as const satisfies ReadonlyArray<{ value: IncidentStatus; label: string }>;

/** 重大度語彙(ヒヤリハット/レベル1/レベル2以上)。CLAUDE.md の3段階警告色(重大=赤/注意=橙/情報=青)に合わせる。 */
export const INCIDENT_SEVERITY_OPTIONS = [
  { value: 'near_miss', label: 'ヒヤリハット' },
  { value: 'level1', label: 'レベル1（軽度）' },
  { value: 'level2', label: 'レベル2以上（中等度以上）' },
] as const satisfies ReadonlyArray<{ value: IncidentSeverity; label: string }>;

function isKnownStatus(value: string): value is IncidentStatus {
  return INCIDENT_STATUS_OPTIONS.some((option) => option.value === value);
}

function isKnownSeverity(value: string): value is IncidentSeverity {
  return INCIDENT_SEVERITY_OPTIONS.some((option) => option.value === value);
}

/** ステータスの表示ラベル。未知値はそのまま表示する(サイレントに握りつぶさない)。 */
export function incidentStatusLabel(status: string): string {
  return INCIDENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** 重大度の表示ラベル。未知値はそのまま表示する。 */
export function incidentSeverityLabel(severity: string): string {
  return INCIDENT_SEVERITY_OPTIONS.find((option) => option.value === severity)?.label ?? severity;
}

/** ステータス変更 UI から PATCH へ渡す前のガード。語彙外の値は送らない。 */
export function toIncidentStatusPatchValue(value: string): IncidentStatus | null {
  return isKnownStatus(value) ? value : null;
}

/**
 * ステータス→StateBadge role。未対応(open)/未知値は要対応(confirm)へフェイルする
 * (誤って完了色に倒れて見落とすのを避ける)。
 */
export function incidentStatusBadgeRole(status: string): StatusRole {
  if (status === 'closed') return 'done';
  if (status === 'reviewed') return 'waiting';
  return 'confirm';
}

/**
 * 重大度→StateBadge role。レベル2以上(level2)は重大(hazard=赤)、レベル1(level1)は注意(confirm=橙)、
 * ヒヤリハット/未知値は情報(info)に倒す。
 */
export function incidentSeverityBadgeRole(severity: string): StatusRole {
  if (severity === 'level2') return 'hazard';
  if (severity === 'level1') return 'confirm';
  return 'info';
}

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

export const INCIDENT_MEMO_FIELD_LABELS = {
  whatHappened: '起きたこと',
  cause: '原因',
  immediateAction: 'すぐ行った対応',
  preventionPlan: '次から変えること',
  relatedProcess: '関係する工程',
} as const satisfies Record<keyof IncidentMemoForm, string>;

export type IncidentMemoFieldKey = keyof IncidentMemoForm;

export type IncidentMemoCompletion = {
  completedCount: number;
  totalCount: number;
  missingLabels: string[];
  isComplete: boolean;
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

/** 当該メモ項目が記入済みか(trim 済み空でない / relatedProcess は既知工程)。未入力強調と完了集計で共用。 */
export function isIncidentMemoFieldFilled(
  form: IncidentMemoForm,
  key: IncidentMemoFieldKey,
): boolean {
  const value = form[key];
  if (key === 'relatedProcess') return isKnownProcess(value);
  return value.trim().length > 0;
}

export function buildIncidentMemoCompletion(form: IncidentMemoForm): IncidentMemoCompletion {
  const keys = Object.keys(INCIDENT_MEMO_FIELD_LABELS) as IncidentMemoFieldKey[];
  const missingLabels = keys
    .filter((key) => !isIncidentMemoFieldFilled(form, key))
    .map((key) => INCIDENT_MEMO_FIELD_LABELS[key]);
  return {
    completedCount: keys.length - missingLabels.length,
    totalCount: keys.length,
    missingLabels,
    isComplete: missingLabels.length === 0,
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

/** 新規記録フォーム(表題は必須、重大度/発生日は任意) */
export type IncidentCreateForm = {
  title: string;
  severity: string; // '' = 未選択(サーバ既定値に任せる)
  occurredAt: string; // 'YYYY-MM-DD' または ''
};

export const EMPTY_INCIDENT_CREATE_FORM: IncidentCreateForm = {
  title: '',
  severity: '',
  occurredAt: '',
};

export type IncidentCreatePayload = {
  title: string;
  severity?: IncidentSeverity;
  occurred_at: string | null;
};

/** 新規記録フォーム→POST ペイロード(表題は trim、既知の重大度のみ送る、発生日はUTC日付境界のISO文字列) */
export function buildIncidentCreatePayload(form: IncidentCreateForm): IncidentCreatePayload {
  return {
    title: form.title.trim(),
    ...(isKnownSeverity(form.severity) ? { severity: form.severity } : {}),
    occurred_at: form.occurredAt ? `${form.occurredAt}T00:00:00.000Z` : null,
  };
}

/** 新規記録フォームの表題バリデーション(空欄は保存不可) */
export function isIncidentCreateFormValid(form: IncidentCreateForm): boolean {
  return form.title.trim().length > 0;
}
