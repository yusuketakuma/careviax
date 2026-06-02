import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';

type KeysetCursorValue = Date | string;

export type DecodedKeysetCursor<TKey extends string> = {
  id: string;
} & Record<TKey, Date>;

function toIsoString(value: KeysetCursorValue) {
  return value instanceof Date ? value.toISOString() : value;
}

function hasDecodedKeysetValues<TKey extends string>(
  keys: readonly TKey[],
  decoded: unknown,
): decoded is DecodedKeysetCursor<TKey> {
  const record = readJsonObject(decoded);
  return typeof record?.id === 'string' && keys.every((key) => record[key] instanceof Date);
}

export function encodeKeysetCursor<TKey extends string>(
  keys: readonly TKey[],
  item: { id: string } & Record<TKey, KeysetCursorValue>,
) {
  const payload = keys.reduce<Record<string, string>>(
    (accumulator, key) => {
      accumulator[key] = toIsoString(item[key]);
      return accumulator;
    },
    { id: item.id },
  );

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeKeysetCursor<TKey extends string>(
  keys: readonly TKey[],
  cursor: string | undefined,
): DecodedKeysetCursor<TKey> | null {
  if (!cursor) return null;

  try {
    const parsed = parseJsonObjectOrNull(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id.trim()) return null;

    const decoded: Record<string, unknown> = { id: parsed.id };
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value !== 'string' || !value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      decoded[key] = date;
    }

    return hasDecodedKeysetValues(keys, decoded) ? decoded : null;
  } catch {
    return null;
  }
}
