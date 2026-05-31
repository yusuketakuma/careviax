export type RealtimeEventPayload = Record<string, unknown> & {
  type: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRealtimeEventPayload(value: unknown): RealtimeEventPayload | null {
  if (!isRecord(value)) return null;

  const type = value.type;
  if (typeof type !== 'string' || type.trim() === '') return null;

  return { ...value, type };
}

export function parseRealtimeEventPayload(raw: string): RealtimeEventPayload | null {
  try {
    return normalizeRealtimeEventPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}
