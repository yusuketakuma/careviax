import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';

export type NotificationStreamItem = {
  id: string;
  type: 'urgent' | 'business' | 'reminder' | 'system';
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const NOTIFICATION_TYPES = new Set<string>(['urgent', 'business', 'reminder', 'system']);

function isNotificationType(value: unknown): value is NotificationStreamItem['type'] {
  return typeof value === 'string' && NOTIFICATION_TYPES.has(value);
}

function normalizeNotificationCreatedAt(value: unknown) {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function normalizeNotificationLink(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export function normalizeNotificationStreamItem(value: unknown): NotificationStreamItem | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.id !== 'string') return null;
  if (!isNotificationType(object.type)) return null;
  if (typeof object.title !== 'string') return null;
  if (typeof object.message !== 'string') return null;
  if (typeof object.is_read !== 'boolean') return null;
  const createdAt = normalizeNotificationCreatedAt(object.created_at);
  if (!createdAt) return null;
  const link = normalizeNotificationLink(object.link);
  if (object.link != null && link == null) return null;

  return {
    id: object.id,
    type: object.type,
    title: object.title,
    message: object.message,
    link,
    is_read: object.is_read,
    created_at: createdAt,
  };
}

export function normalizeNotificationStreamPayload(value: unknown): NotificationStreamItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const notification = normalizeNotificationStreamItem(item);
    return notification ? [notification] : [];
  });
}

export function parseNotificationStreamPayload(raw: string): NotificationStreamItem[] {
  const parsed = parseJsonOrNull(raw);
  return normalizeNotificationStreamPayload(parsed);
}
