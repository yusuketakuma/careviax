export type PaginatedResponse<T> = {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
  totalCount?: number;
};

export function parsePaginationParams(searchParams: URLSearchParams) {
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const offset = cursor ? parseInt(cursor, 10) : 0;
  return { cursor, limit, offset };
}
