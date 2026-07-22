import { Bell, MessageSquareText, Smartphone } from 'lucide-react';
import {
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
} from '@/lib/browser-notifications';
import type { StatusRole } from '@/lib/constants/status-tokens';
import type { EscalationRulesResponse } from '@/lib/escalation-rules/response-schema';
import type { NotificationRulesResponse } from '@/lib/notification-rules/response-schema';

export type NotificationRule = NotificationRulesResponse['data'][number];
export type EscalationRule = EscalationRulesResponse['data'][number];

export type NotificationListMeta = {
  totalCount: number;
  visibleCount: number;
  hiddenCount: number;
  truncated: boolean;
  limit: number | null;
};

export type EventConfig = {
  eventType: string;
  title: string;
  description: string;
  badge: 'urgent' | 'business' | 'reminder';
};

export const EVENT_CONFIGS: EventConfig[] = [
  {
    eventType: 'patient_self_report_followup_due',
    title: '患者・家族の自己申告フォロー',
    description: '自己申告や折り返し依頼への対応を通知します。',
    badge: 'urgent',
  },
  {
    eventType: 'visit_schedule_reschedule_requested',
    title: '訪問リスケ承認依頼',
    description: '確定済み訪問の変更承認待ちを通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_schedule_reschedule_approved',
    title: '訪問リスケ承認結果',
    description: '変更承認後の確定待ち状態を通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_intake_linkage_due',
    title: '処方受付から訪問候補への接続漏れ',
    description: '訪問候補や架電導線の未作成を通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_demand_created',
    title: '訪問候補の自動提案',
    description: '服薬期限に応じた新規訪問候補の生成を通知します。',
    badge: 'business',
  },
  {
    eventType: 'medication_deadline_approaching',
    title: '服用最終日接近',
    description: '服薬終了が近い患者の訪問準備を通知します。',
    badge: 'reminder',
  },
  {
    eventType: 'refill_due_soon',
    title: 'リフィル調剤期日接近',
    description: '次回調剤日が近いリフィル処方を通知します。',
    badge: 'reminder',
  },
  {
    eventType: 'management_plan_review_due',
    title: '管理計画書レビュー期限',
    description: '計画書の見直し期限到来を通知します。',
    badge: 'reminder',
  },
];

// Notification event classes: urgent=blocked, business=info, reminder=confirm.
export const BADGE_VARIANTS: Record<EventConfig['badge'], { label: string; role: StatusRole }> = {
  urgent: { label: '緊急', role: 'blocked' },
  business: { label: '業務', role: 'info' },
  reminder: { label: 'リマインド', role: 'confirm' },
};

export const NOTIFICATION_CHANNEL_OPTIONS = [
  { value: 'in_app', label: 'アプリ内', description: '通知センターとベルに表示', icon: Bell },
  { value: 'sms', label: 'SMS', description: '電話番号登録ユーザーへ送信', icon: Smartphone },
  {
    value: 'line',
    label: 'LINE',
    description: 'LINE アダプタ経由で送信',
    icon: MessageSquareText,
  },
  {
    value: 'fax',
    label: 'FAX',
    description: 'FAX 送付タスクの通知先として扱う',
    icon: MessageSquareText,
  },
  {
    value: 'mcs',
    label: 'MCS',
    description: 'MCS 連携先への通知先として扱う',
    icon: MessageSquareText,
  },
] as const;

export type SupportedNotificationChannel = (typeof NOTIFICATION_CHANNEL_OPTIONS)[number]['value'];

export const NOTIFICATION_CHANNEL_LABELS = Object.fromEntries(
  NOTIFICATION_CHANNEL_OPTIONS.map((channel) => [channel.value, channel.label]),
) as Record<SupportedNotificationChannel, string>;

export const ESCALATION_THRESHOLD_ERROR_MESSAGE = 'しきい時間は 1〜720 の整数で入力してください';
export const ESCALATION_THRESHOLD_HELP_ID = 'escalation-threshold-help';
export const ESCALATION_THRESHOLD_ERROR_ID = 'escalation-threshold-error';

export const ESCALATION_TRIGGER_OPTIONS: Array<{
  value: EscalationRule['trigger_type'];
  label: string;
  description: string;
}> = [
  {
    value: 'communication_response_overdue',
    label: '連携返信期限超過',
    description: '医師・多職種への返信待ちが SLA を超えた場合に反応します。',
  },
  {
    value: 'workflow_exception_unresolved',
    label: 'WorkflowException 未解消',
    description: '差戻しや止まっている業務が残り続けた場合に反応します。',
  },
  {
    value: 'report_delivery_failed',
    label: '報告書送付失敗',
    description: '送付失敗や再送待ちが一定時間を超えた場合に反応します。',
  },
  {
    value: 'billing_review_stalled',
    label: '請求レビュー停滞',
    description: '請求候補のレビュー待ちが積み上がった場合に反応します。',
  },
  {
    value: 'visit_reschedule_unapproved',
    label: '訪問変更承認待ち',
    description: 'リスケ提案の承認待ちが長引いた場合に反応します。',
  },
];

export const ESCALATION_ACTION_OPTIONS: Array<{
  value: EscalationRule['action'];
  label: string;
}> = [
  { value: 'in_app_notification', label: 'アプリ内通知' },
  { value: 'email_digest', label: 'メール通知' },
  { value: 'conference_task', label: 'タスク起票' },
  { value: 'admin_alert', label: '管理者アラート' },
];

export const ESCALATION_ROLE_OPTIONS: Array<{
  value: NonNullable<EscalationRule['notify_role']>;
  label: string;
}> = [
  { value: 'admin', label: '管理者' },
  { value: 'manager', label: 'マネージャー' },
  { value: 'pharmacist', label: '薬剤師' },
  { value: 'office_staff', label: '事務' },
];

export function escalationRuleSummary(rule: EscalationRule) {
  const trigger =
    ESCALATION_TRIGGER_OPTIONS.find((item) => item.value === rule.trigger_type)?.label ??
    rule.trigger_type;
  const action =
    ESCALATION_ACTION_OPTIONS.find((item) => item.value === rule.action)?.label ?? rule.action;
  const role = rule.notify_role
    ? (ESCALATION_ROLE_OPTIONS.find((item) => item.value === rule.notify_role)?.label ??
      rule.notify_role)
    : '通知先未指定';
  const thresholdHours = rule.condition?.threshold_hours ?? '未設定';

  return `${trigger} / ${action} / ${role} / ${thresholdHours}時間`;
}

export function isPermissionSupported() {
  return isBrowserNotificationSupported();
}

export function readBrowserNotificationState(): {
  permission: NotificationPermission | 'unsupported';
  enabled: boolean;
} {
  if (!isPermissionSupported()) {
    return { permission: 'unsupported', enabled: false };
  }
  return {
    permission: Notification.permission,
    enabled: getBrowserNotificationPreference(),
  };
}
