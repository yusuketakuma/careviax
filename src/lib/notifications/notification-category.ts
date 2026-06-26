/**
 * design/ v1.9 p0_04「お知らせ一覧」の 5 分類。
 * Notification の type/event_type からの表示時マッピング(enum 拡張はしない)。
 * 「未同期」だけはサーバー通知ではなく offline-store からのクライアント合成行。
 */

export type NotificationCategory = 'urgent' | 'pharmacist' | 'clerk' | 'reply' | 'unsynced';

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  urgent: '急ぎ',
  pharmacist: '薬剤師確認',
  clerk: '事務で対応',
  reply: '返信待ち',
  unsynced: '未同期',
};

/** バッジ色: 急ぎ=赤 / 事務で対応=橙 / 薬剤師確認=紫 / 返信待ち=青 / 未同期=灰 */
export const NOTIFICATION_CATEGORY_BADGE_CLASSES: Record<NotificationCategory, string> = {
  urgent: 'bg-state-blocked/10 text-state-blocked border-state-blocked/20',
  pharmacist: 'bg-state-waiting/10 text-state-waiting border-state-waiting/20',
  clerk: 'bg-state-confirm/10 text-state-confirm border-state-confirm/20',
  reply: 'bg-tag-info/10 text-tag-info border-tag-info/20',
  unsynced: 'bg-state-readonly/10 text-state-readonly border-state-readonly/20',
};

const PHARMACIST_EVENT_PATTERNS = [
  'prescription',
  'diff',
  'dispens',
  'audit',
  'cds',
  'drug',
  'medication',
  'inquiry',
];

const CLERK_EVENT_PATTERNS = [
  'schedule',
  'contact',
  'delivery',
  'document',
  'billing',
  'shift',
  'previsit',
];

const REPLY_EVENT_PATTERNS = ['reply', 'response', 'awaiting'];

/**
 * サーバー通知 1 件を 5 分類へ写像する。
 * 優先順: 急ぎ(type=urgent)> 返信待ち > 薬剤師確認 > 事務で対応。
 * どれにも当たらないものは null(「すべて」でのみ表示)。
 */
export function classifyNotification(notification: {
  type: string;
  event_type?: string | null;
}): NotificationCategory | null {
  if (notification.type === 'urgent') return 'urgent';
  // system 通知(マスタ更新等)は 5 分類に乗せず「すべて」でのみ表示する
  if (notification.type === 'system') return null;

  const eventType = (notification.event_type ?? '').toLowerCase();
  if (REPLY_EVENT_PATTERNS.some((pattern) => eventType.includes(pattern))) return 'reply';
  if (PHARMACIST_EVENT_PATTERNS.some((pattern) => eventType.includes(pattern))) {
    return 'pharmacist';
  }
  if (CLERK_EVENT_PATTERNS.some((pattern) => eventType.includes(pattern))) return 'clerk';

  if (notification.type === 'reminder') return 'reply';
  if (notification.type === 'business') return 'clerk';
  return null;
}
