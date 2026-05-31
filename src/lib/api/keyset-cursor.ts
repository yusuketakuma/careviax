type KeysetCursorValue = Date | string;

export type DecodedKeysetCursor<TKey extends string> = {
  id: string;
} & Record<TKey, Date>;

function toIsoString(value: KeysetCursorValue) {
  return value instanceof Date ? value.toISOString() : value;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
    const parsed = readObject(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;

    const decodedValues = {} as Partial<Record<TKey, Date>>;
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value !== 'string' || !value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      decodedValues[key] = date;
    }

    return { id: parsed.id, ...decodedValues } as DecodedKeysetCursor<TKey>;
  } catch {
    return null;
  }
}
