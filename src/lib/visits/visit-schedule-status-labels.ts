export const PROPOSAL_STATUS_LABELS = {
  proposed: '提案中',
  patient_contact_pending: '架電待ち',
  confirmed: '確定済み',
  rejected: '却下',
  superseded: '差替済み',
  expired: '期限切れ',
  reschedule_pending: '再調整中',
} as const;

export const CONTACT_STATUS_LABELS = {
  pending: '未架電',
  attempted: '架電済み',
  confirmed: '患者確認済み',
  declined: '辞退',
  change_requested: '変更希望',
  unreachable: '不通',
} as const;
