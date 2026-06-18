export type PaginatedResponse<T> = {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
  totalCount?: number;
};

export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => string | undefined,
): PaginatedResponse<T> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  const data = rows.length > normalizedLimit ? rows.slice(0, normalizedLimit) : [...rows];
  const hasMore = rows.length > normalizedLimit;
  return {
    data,
    hasMore,
    nextCursor: hasMore ? cursorOf(data[data.length - 1]!) : undefined,
  };
}

export function parseBoundedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const normalized = value?.trim() ?? '';
  if (!/^-?\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export type OptionalBoundedIntegerParamResult =
  | { ok: true; value: number | undefined }
  | { ok: false };

export function parseOptionalBoundedIntegerParam(
  value: string | null,
  min: number,
  max: number,
): OptionalBoundedIntegerParamResult {
  if (value === null) return { ok: true, value: undefined };

  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return { ok: false };

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

export function parsePaginationParams(searchParams: URLSearchParams) {
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = parseBoundedInteger(searchParams.get('limit'), 50, 1, 100);
  const offset = cursor ? parseBoundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER) : 0;
  return { cursor, limit, offset };
}
