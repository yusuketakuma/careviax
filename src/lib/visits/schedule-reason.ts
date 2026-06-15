/**
 * 訪問予定の取消・再開(p0_37)で記録する理由カタログ。
 * UI のチップ表示(ReasonDialog)と API のバリデーション・監査ログが同じ一覧を共有する。
 */

export const VISIT_SCHEDULE_CANCEL_REASON_OPTIONS = [
  { code: 'patient_request', label: '患者都合' },
  { code: 'condition_change', label: '体調変化・入院' },
  { code: 'family_request', label: '家族都合' },
  { code: 'reschedule_needed', label: '日程変更' },
  { code: 'input_error', label: '入力間違い' },
  { code: 'other', label: 'その他' },
] as const;

// p0_37 の target PNG は p0_36 と同じ理由文言を表示する。
// API/監査ログは上の業務理由ラベルを使い続けるため、Dialog の表示専用に分ける。
export const VISIT_SCHEDULE_CANCEL_REASON_DIALOG_OPTIONS = [
  { code: 'patient_request', label: '数量が違う' },
  { code: 'condition_change', label: '中止薬が残っている' },
  { code: 'family_request', label: '写真が足りない' },
  { code: 'reschedule_needed', label: '患者都合' },
  { code: 'input_error', label: '入力間違い' },
  { code: 'other', label: 'その他' },
] as const;

export type VisitScheduleCancelReasonCode =
  (typeof VISIT_SCHEDULE_CANCEL_REASON_OPTIONS)[number]['code'];

export const VISIT_SCHEDULE_CANCEL_REASON_CODES = VISIT_SCHEDULE_CANCEL_REASON_OPTIONS.map(
  (option) => option.code,
) as [VisitScheduleCancelReasonCode, ...VisitScheduleCancelReasonCode[]];

export function visitScheduleCancelReasonLabel(code: string): string {
  return VISIT_SCHEDULE_CANCEL_REASON_OPTIONS.find((option) => option.code === code)?.label ?? code;
}
