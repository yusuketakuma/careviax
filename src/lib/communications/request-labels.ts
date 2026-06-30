export const COMMUNICATION_REQUEST_TYPE_LABELS: Record<string, string> = {
  physician_inquiry: '疑義照会',
  tracing_report: '服薬情報提供書',
  care_report_reply_request: '報告書返信依頼',
  patient_share_reply_request: '患者共有返信依頼',
  schedule_change: '訪問予定変更',
  emergency_contact_review: '緊急連絡先確認',
  emergency_physician: '主治医緊急連絡',
  emergency_nurse: '訪問看護緊急連絡',
  emergency_family: '家族緊急連絡',
  prescriber_followup: '処方医フォロー',
};

export const COMMUNICATION_RECIPIENT_ROLE_LABELS: Record<string, string> = {
  physician: '主治医',
  doctor: '主治医',
  care_manager: 'ケアマネ',
  nurse: '訪問看護',
  visiting_nurse: '訪問看護',
  facility: '施設',
  family: '家族',
  mcs: 'MCS',
  internal: '内部',
};

export function formatCommunicationRequestTypeLabel(value: string | null | undefined) {
  if (!value) return '依頼';
  const normalized = value.trim();
  if (!normalized) return '依頼';
  return COMMUNICATION_REQUEST_TYPE_LABELS[normalized] ?? `未登録種別: ${normalized}`;
}

export function formatCommunicationRecipientRoleLabel(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return COMMUNICATION_RECIPIENT_ROLE_LABELS[normalized] ?? normalized;
}
