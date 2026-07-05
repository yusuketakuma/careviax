export const AUDIT_LOG_TARGET_TYPE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'patient', label: '患者' },
  { value: 'consent_record', label: '同意記録' },
  { value: 'PatientShareCase', label: '患者共有ケース' },
  { value: 'PatientShareConsent', label: '患者共有同意' },
  { value: 'patient_share_consent', label: '患者共有同意DB' },
  { value: 'PatientLink', label: '患者リンク' },
  { value: 'patient_link', label: '患者リンクDB' },
  { value: 'PatientShareCorrectionRequest', label: '共有情報訂正依頼' },
  { value: 'patient_share_correction_request', label: '共有情報訂正依頼DB' },
  { value: 'PharmacyInvoice', label: '薬局間請求書' },
  { value: 'file_asset', label: 'ファイル' },
  { value: 'care_report', label: '報告書' },
  { value: 'CareReport', label: '報告書DB' },
  { value: 'audit_log', label: '監査ログ' },
  { value: 'prescription', label: '処方箋' },
  { value: 'dispense', label: '調剤' },
  { value: 'visit_record', label: '訪問記録' },
  { value: 'user', label: 'ユーザー' },
  { value: 'setting', label: '設定' },
] as const;

export const AUDIT_LOG_ACTION_LABEL_MAP = {
  create: '作成',
  update: '更新',
  delete: '削除',
  read: '閲覧',
  login: 'ログイン',
  logout: 'ログアウト',
  export: 'エクスポート',
  approve: '承認',
  reject: '差戻し',
  consent_records_viewed: '同意記録一覧閲覧',
  consent_record_viewed: '同意記録閲覧',
  consent_record_created: '同意記録作成',
  consent_record_updated: '同意記録更新',
  consent_record_revoked: '同意記録撤回',
  'consent_record.create': '同意記録DB作成',
  'consent_record.update': '同意記録DB更新',
  'consent_record.delete': '同意記録DB削除',
  patient_share_cases_viewed: '患者共有ケース閲覧',
  patient_share_case_created: '患者共有ケース作成',
  patient_share_case_activated: '患者共有ケース共有開始',
  patient_share_consents_viewed: '患者共有同意一覧閲覧',
  patient_share_consent_registered: '患者共有同意登録',
  patient_share_consent_revoked: '患者共有同意撤回',
  'patient_share_consent.create': '患者共有同意DB作成',
  'patient_share_consent.update': '患者共有同意DB更新',
  'patient_share_consent.delete': '患者共有同意DB削除',
  patient_link_base_approved: '患者リンク基幹承認',
  patient_link_accepted: '患者リンク受諾',
  patient_link_declined: '患者リンク辞退',
  'patient_link.create': '患者リンクDB作成',
  'patient_link.update': '患者リンクDB更新',
  'patient_link.delete': '患者リンクDB削除',
  patient_share_correction_requested: '共有情報訂正依頼',
  'patient_share_correction_request.create': '共有情報訂正依頼DB作成',
  'patient_share_correction_request.update': '共有情報訂正依頼DB更新',
  'patient_share_correction_request.delete': '共有情報訂正依頼DB削除',
  pharmacy_invoice_draft_created: '薬局間請求書ドラフト作成',
  pharmacy_invoice_issued: '薬局間請求書発行',
  pharmacy_invoice_sent: '薬局間請求書送付',
  pharmacy_invoice_received: '薬局間請求書受領',
  pharmacy_invoice_payment_scheduled: '薬局間請求書支払予定',
  pharmacy_invoice_payment_recorded: '薬局間請求書入金記録',
  pharmacy_invoice_cancelled: '薬局間請求書取消',
  pharmacy_invoice_reissued: '薬局間請求書再発行',
  care_report_print_previewed: '報告書印刷プレビュー',
  care_report_print_requested: '報告書印刷要求',
  care_report_confirmed: '報告書確認',
  care_report_delivery_attempted: '報告書送信試行',
  'care_report.send': '報告書送信',
  file_download: 'ファイルダウンロード',
  audit_log_viewed: '監査ログ閲覧',
  visit_schedule_updated: '訪問予定更新',
  visit_schedule_reschedule_requested: '訪問予定再調整依頼',
} as const satisfies Record<string, string>;

export const AUDIT_LOG_ACTION_OPTIONS = [
  { value: '', label: 'すべて' },
  ...Object.entries(AUDIT_LOG_ACTION_LABEL_MAP).map(([value, label]) => ({ value, label })),
] as const;

export const AUDIT_LOG_RISK_TIER_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'high', label: '高リスク' },
  { value: 'standard', label: '通常' },
] as const;

export const AUDIT_LOG_REVIEW_STATE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'pending', label: 'レビュー待ち' },
  { value: 'reviewed', label: 'レビュー済み' },
] as const;

export const AUDIT_LOG_REVIEW_STATE_LABEL_MAP = {
  pending: 'レビュー待ち',
  reviewed: 'レビュー済み',
} as const satisfies Record<string, string>;

export const AUDIT_LOG_REVIEW_REASON_OPTIONS = Object.entries(
  AUDIT_LOG_REVIEW_REASON_LABEL_MAP,
).map(([value, label]) => ({ value, label }));

export const AUDIT_LOG_REDACTION_STATE_LABEL_MAP = {
  redacted: '本文マスク済',
  minimized: '最小化済',
  not_applicable: '対象外',
} as const satisfies Record<string, string>;
import { AUDIT_LOG_REVIEW_REASON_LABEL_MAP } from '@/lib/audit-logs/review';
