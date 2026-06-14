export const CASE_STATUS_LABELS: Record<string, string> = {
  referral_received: '紹介受領',
  assessment: 'アセスメント',
  active: '稼働中',
  on_hold: '保留',
  discharged: '終了',
  terminated: '解約',
};

export const CASE_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  referral_received: 'secondary',
  assessment: 'secondary',
  active: 'default',
  on_hold: 'outline',
  discharged: 'outline',
  terminated: 'destructive',
};

export const GENDER_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

export const VISIT_OUTCOME_LABELS: Record<string, string> = {
  completed: '完了',
  revisit_needed: '再訪問必要',
  postponed: '延期',
  cancelled: 'キャンセル',
  delivery_only: '配薬のみ',
  completed_with_issue: '課題あり完了',
};

export const VISIT_OUTCOME_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  completed: 'default',
  revisit_needed: 'secondary',
  postponed: 'outline',
  cancelled: 'destructive',
  delivery_only: 'outline',
  completed_with_issue: 'secondary',
};

export const PRIORITY_LABELS: Record<string, string> = {
  emergency: '緊急',
  urgent: '至急',
  normal: '通常',
};

export const PRIORITY_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  emergency: 'destructive',
  urgent: 'secondary',
  normal: 'default',
};

export type StatusConfig = {
  label: string;
  variant: 'outline' | 'default' | 'destructive' | 'secondary';
};

export const REPORT_TYPE_LABELS: Record<string, string> = {
  physician_report: '医師向け報告書',
  care_manager_report: 'ケアマネ向け報告書',
  facility_handoff: '施設引継書',
  nurse_share: '看護師共有',
  family_share: '家族共有',
  internal_record: '内部記録',
};

export const REPORT_STATUS_CONFIG: Record<string, StatusConfig> = {
  draft: { label: '下書き', variant: 'outline' },
  sent: { label: '送付済', variant: 'default' },
  failed: { label: '送付失敗', variant: 'destructive' },
  confirmed: { label: '確認済', variant: 'default' },
  response_waiting: { label: '返信待ち', variant: 'secondary' },
};

export const CHANNEL_LABELS: Record<string, string> = {
  ph_os_share: 'PH-OS共有',
  email: 'メール',
  fax: 'FAX',
  phone: '電話',
  in_person: '手渡し',
  postal: '郵便',
  ses: 'メール(SES)',
};

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
};

export const SCHEDULE_STATUS_STYLES: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-800',
  in_preparation: 'bg-blue-100 text-blue-800',
  ready: 'bg-green-100 text-green-800',
  departed: 'bg-green-200 text-green-900',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
  postponed: 'bg-orange-100 text-orange-800',
};
