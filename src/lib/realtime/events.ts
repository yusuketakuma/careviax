import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';

export type RealtimeEventPayload = Record<string, unknown> & {
  type: string;
};

export function normalizeRealtimeEventPayload(value: unknown): RealtimeEventPayload | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const type = object.type;
  if (typeof type !== 'string' || type.trim() === '') return null;

  return { ...object, type };
}

export function parseRealtimeEventPayload(raw: string): RealtimeEventPayload | null {
  return normalizeRealtimeEventPayload(parseJsonObjectOrNull(raw));
}
