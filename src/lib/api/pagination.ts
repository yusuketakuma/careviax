export type PaginatedResponse<T> = {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
  totalCount?: number;
};

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const normalized = value?.trim() ?? '';
  if (!/^-?\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parsePaginationParams(searchParams: URLSearchParams) {
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = parseBoundedInteger(searchParams.get('limit'), 50, 1, 100);
  const offset = cursor ? parseBoundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER) : 0;
  return { cursor, limit, offset };
}
