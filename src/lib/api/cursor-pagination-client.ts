import { readJsonObject } from '@/lib/db/json';
import { readJsonResponseBody } from './response-body';

export type CursorPaginatedPage<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
};

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

function normalizeCursorPage<T, TPage extends CursorPaginatedPage<T>>(
  payload: unknown,
): { page: CursorPaginatedPage<T>; metadata: Omit<TPage, keyof CursorPaginatedPage<T>> } | null {
  const object = readJsonObject(payload);
  if (!object) return null;
  if (!Array.isArray(object.data)) return null;
  if (typeof object.hasMore !== 'boolean') return null;
  if (object.nextCursor !== undefined && typeof object.nextCursor !== 'string') return null;

  const { data, hasMore, nextCursor, ...metadata } = object;
  return {
    page: {
      data: data as T[],
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    },
    metadata: metadata as Omit<TPage, keyof CursorPaginatedPage<T>>,
  };
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

    const normalized = normalizeCursorPage<T, TPage>(await readJsonResponseBody(response));
    if (!normalized) {
      throw new Error(args.errorMessage);
    }

    const { data, hasMore, nextCursor } = normalized.page;
    const metadata = normalized.metadata;
    firstPageMetadata ??= metadata;
    aggregated.push(...data);

    if (!hasMore || !nextCursor) {
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
    hasMore: false,
    nextCursor: undefined,
  };
}
