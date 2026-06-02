import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';

export const USER_NOTIFICATION_SETTINGS_STORAGE_KEY = 'ph-os:user-notification-settings';

export type UserNotificationSetting = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
};

export const DEFAULT_USER_NOTIFICATION_SETTINGS: UserNotificationSetting[] = [
  {
    id: 'visit-reminder',
    label: '訪問リマインド',
    description: '訪問予定の30分前に通知を受け取ります',
    enabled: true,
  },
  {
    id: 'report-deadline',
    label: '報告書期限',
    description: '報告書の提出期限が近づくと通知を受け取ります',
    enabled: true,
  },
  {
    id: 'prescription-new',
    label: '新規処方箋',
    description: '新しい処方箋が登録されたときに通知を受け取ります',
    enabled: true,
  },
  {
    id: 'audit-result',
    label: '鑑査結果',
    description: '鑑査結果が確定したときに通知を受け取ります',
    enabled: false,
  },
  {
    id: 'communication-request',
    label: '連携依頼',
    description: '多職種からの連携依頼を受信したときに通知を受け取ります',
    enabled: true,
  },
  {
    id: 'schedule-change',
    label: 'スケジュール変更',
    description: '訪問スケジュールが変更されたときに通知を受け取ります',
    enabled: false,
  },
  {
    id: 'system-maintenance',
    label: 'システムメンテナンス',
    description: 'メンテナンス予定のお知らせを受け取ります',
    enabled: true,
  },
];

export function normalizeUserNotificationSettings(value: unknown): UserNotificationSetting[] {
  if (!Array.isArray(value)) {
    return DEFAULT_USER_NOTIFICATION_SETTINGS;
  }

  const enabledById = new Map<string, boolean>();
  for (const item of value) {
    const candidate = readJsonObject(item);
    if (!candidate) continue;
    if (typeof candidate.id === 'string' && typeof candidate.enabled === 'boolean') {
      enabledById.set(candidate.id, candidate.enabled);
    }
  }

  return DEFAULT_USER_NOTIFICATION_SETTINGS.map((setting) => ({
    ...setting,
    enabled: enabledById.get(setting.id) ?? setting.enabled,
  }));
}

export function parseUserNotificationSettingsStorage(raw: string | null | undefined) {
  return normalizeUserNotificationSettings(parseJsonOrNull(raw));
}
