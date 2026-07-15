import type { PaginatedResponse } from './pagination';

export type ListEnvelope<T, TMeta extends Record<string, unknown>> = {
  data: readonly T[];
  meta: {
    generated_at: string;
  } & TMeta;
};

export type CursorListMeta = {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};

export type CountedListMeta = {
  total_count: number;
  visible_count: number;
  hidden_count: number;
  truncated: boolean;
};

type CountedListRouteMeta<TMeta extends Record<string, unknown>> = TMeta &
  Partial<Record<keyof CountedListMeta | 'generated_at', never>>;

export function buildListEnvelope<T, TMeta extends Record<string, unknown>>(
  data: readonly T[],
  meta: TMeta & { generated_at?: never },
  generatedAt: Date = new Date(),
): ListEnvelope<T, TMeta> {
  return {
    data,
    meta: {
      generated_at: generatedAt.toISOString(),
      ...meta,
    },
  };
}

export function buildCursorListEnvelope<T>(
  page: PaginatedResponse<T>,
  limit: number,
  generatedAt: Date = new Date(),
): ListEnvelope<T, CursorListMeta> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Cursor list envelope invariant violated: limit must be a positive integer');
  }

  const hasUsableNextCursor =
    typeof page.nextCursor === 'string' && page.nextCursor.trim().length > 0;
  if ((page.hasMore && !hasUsableNextCursor) || (!page.hasMore && page.nextCursor !== undefined)) {
    throw new Error('Cursor list envelope invariant violated: next cursor must match has more');
  }

  return buildListEnvelope(
    page.data,
    {
      limit,
      has_more: page.hasMore,
      next_cursor: page.nextCursor ?? null,
    },
    generatedAt,
  );
}

export type CountedListEnvelope<T> = CountedListMeta & {
  data: readonly T[];
};

export function buildCountedListEnvelope<T>(
  data: readonly T[],
  totalCount: number,
): CountedListEnvelope<T> {
  const visibleCount = data.length;
  const hiddenCount = Math.max(totalCount - visibleCount, 0);

  return {
    data,
    total_count: totalCount,
    visible_count: visibleCount,
    hidden_count: hiddenCount,
    truncated: hiddenCount > 0,
  };
}

export function buildCountedListResponse<T, TMeta extends Record<string, unknown>>(
  data: readonly T[],
  totalCount: number,
  meta: CountedListRouteMeta<TMeta>,
  generatedAt: Date = new Date(),
): ListEnvelope<T, CountedListMeta & TMeta> {
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new Error('Counted list envelope invariant violated: total count must be non-negative');
  }

  const counted = buildCountedListEnvelope(data, totalCount);

  return buildListEnvelope(
    counted.data,
    {
      total_count: counted.total_count,
      visible_count: counted.visible_count,
      hidden_count: counted.hidden_count,
      truncated: counted.truncated,
      ...meta,
    },
    generatedAt,
  );
}
