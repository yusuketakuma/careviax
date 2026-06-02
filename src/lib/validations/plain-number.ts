const PLAIN_DECIMAL_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;

export function normalizeNullablePlainNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  return PLAIN_DECIMAL_NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : value;
}
