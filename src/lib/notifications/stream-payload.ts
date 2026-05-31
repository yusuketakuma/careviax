import { readJsonObject } from '@/lib/db/json';

export type NotificationStreamItem = {
  id: string;
  type: 'urgent' | 'business' | 'reminder' | 'system';
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const NOTIFICATION_TYPES = new Set<NotificationStreamItem['type']>([
  'urgent',
  'business',
  'reminder',
  'system',
]);

function readNotificationStreamItem(value: unknown): NotificationStreamItem | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.id !== 'string') return null;
  if (
    typeof object.type !== 'string' ||
    !NOTIFICATION_TYPES.has(object.type as NotificationStreamItem['type'])
  ) {
    return null;
  }
  if (typeof object.title !== 'string') return null;
  if (typeof object.message !== 'string') return null;
  if (object.link !== null && typeof object.link !== 'string') return null;
  if (typeof object.is_read !== 'boolean') return null;
  if (typeof object.created_at !== 'string') return null;

  return {
    id: object.id,
    type: object.type as NotificationStreamItem['type'],
    title: object.title,
    message: object.message,
    link: object.link,
    is_read: object.is_read,
    created_at: object.created_at,
  };
}

export function parseNotificationStreamPayload(raw: string): NotificationStreamItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const notification = readNotificationStreamItem(item);
    return notification ? [notification] : [];
  });
}
