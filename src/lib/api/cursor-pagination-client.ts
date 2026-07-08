import type { ZodType } from 'zod';
import { normalizeCursorPaginatedPagePayload, type CursorPaginatedPage } from './response-schemas';
import { readJsonResponseBody } from './response-body';

type CursorPaginatedResult<T, TPage extends CursorPaginatedPage<T>> = Omit<
  TPage,
  keyof CursorPaginatedPage<T>
> &
  CursorPaginatedPage<T>;

export const CURSOR_PAGINATION_PAGE_LIMIT = 100;

function normalizePageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return CURSOR_PAGINATION_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), CURSOR_PAGINATION_PAGE_LIMIT);
}

function normalizeMaxPages(maxPages: number | undefined) {
  if (maxPages === undefined || !Number.isFinite(maxPages)) return 20;
  return Math.max(Math.trunc(maxPages), 1);
}

export async function fetchAllCursorPages<
  T,
  TPage extends CursorPaginatedPage<T> = CursorPaginatedPage<T>,
>(args: {
  path: string;
  params?: URLSearchParams;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
  errorMessage: string;
  itemSchema?: ZodType<T>;
}): Promise<CursorPaginatedResult<T, TPage>> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const limit = normalizePageLimit(args.limit);
  const maxPages = normalizeMaxPages(args.maxPages);
  const aggregated: T[] = [];
  let cursor: string | undefined;
  let firstPageMetadata: Omit<TPage, keyof CursorPaginatedPage<T>> | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams(args.params);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    const response = await fetchImpl(query ? `${args.path}?${query}` : args.path, args.init);
    if (!response.ok) {
      throw new Error(args.errorMessage);
    }

    const normalized = normalizeCursorPaginatedPagePayload<T>(
      await readJsonResponseBody(response),
      args.itemSchema,
    );
    if (!normalized) {
      throw new Error(args.errorMessage);
    }

    const { data, hasMore, nextCursor } = normalized.page;
    const metadata = normalized.metadata as Omit<TPage, keyof CursorPaginatedPage<T>>;
    firstPageMetadata ??= metadata;
    aggregated.push(...data);

    if (!hasMore || !nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = nextCursor;
  }

  if (!firstPageMetadata) {
    throw new Error(args.errorMessage);
  }

  return {
    ...firstPageMetadata,
    data: aggregated,
    hasMore: Boolean(cursor),
    nextCursor: cursor,
  };
}

function readMetaCursorPage<T>(
  payload: unknown,
  itemSchema: ZodType<T> | undefined,
): CursorPaginatedPage<T> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const object = payload as Record<string, unknown>;
  if (!Array.isArray(object.data)) return null;
  if (typeof object.meta !== 'object' || object.meta === null || Array.isArray(object.meta)) {
    return null;
  }

  const meta = object.meta as Record<string, unknown>;
  if (typeof meta.has_more !== 'boolean') return null;
  const rawNextCursor = meta.next_cursor;
  const nextCursor =
    typeof rawNextCursor === 'string' && rawNextCursor.trim().length > 0
      ? rawNextCursor
      : undefined;
  if (rawNextCursor !== null && rawNextCursor !== undefined && nextCursor === undefined) {
    return null;
  }
  if (meta.has_more && !nextCursor) return null;

  const data: T[] = [];
  for (const item of object.data) {
    if (!itemSchema) {
      data.push(item as T);
      continue;
    }
    const parsed = itemSchema.safeParse(item);
    if (!parsed.success) return null;
    data.push(parsed.data);
  }

  return {
    data,
    hasMore: meta.has_more,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export async function fetchAllMetaCursorPages<T>(args: {
  path: string;
  params?: URLSearchParams;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
  errorMessage: string;
  itemSchema?: ZodType<T>;
}): Promise<CursorPaginatedPage<T>> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const limit = normalizePageLimit(args.limit);
  const maxPages = normalizeMaxPages(args.maxPages);
  const aggregated: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams(args.params);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    const response = await fetchImpl(query ? `${args.path}?${query}` : args.path, args.init);
    if (!response.ok) {
      throw new Error(args.errorMessage);
    }

    const pagePayload = readMetaCursorPage<T>(
      await readJsonResponseBody(response),
      args.itemSchema,
    );
    if (!pagePayload) {
      throw new Error(args.errorMessage);
    }

    aggregated.push(...pagePayload.data);
    if (!pagePayload.hasMore || !pagePayload.nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = pagePayload.nextCursor;
  }

  return {
    data: aggregated,
    hasMore: Boolean(cursor),
    ...(cursor ? { nextCursor: cursor } : {}),
  };
}
