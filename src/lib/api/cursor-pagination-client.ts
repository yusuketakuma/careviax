import { z, type ZodType } from 'zod';
import { apiCursorPageSchema, type CursorPaginatedPage } from './response-schemas';
import { readJsonResponseBody } from './response-body';

export const CURSOR_PAGINATION_PAGE_LIMIT = 100;

type FetchCursorPageArgs<T> = {
  path: string;
  params?: URLSearchParams;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  limit?: number;
  cursor?: string;
  errorMessage: string;
  itemSchema?: ZodType<T>;
};

export type CompleteCursorCollection<T> = {
  data: T[];
  hasMore: false;
  nextCursor?: never;
};

function normalizePageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return CURSOR_PAGINATION_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), CURSOR_PAGINATION_PAGE_LIMIT);
}

function normalizeMaxPages(maxPages: number | undefined) {
  if (maxPages === undefined || !Number.isFinite(maxPages)) return 20;
  return Math.max(Math.trunc(maxPages), 1);
}

export async function fetchCursorPage<T>(
  args: FetchCursorPageArgs<T>,
): Promise<CursorPaginatedPage<T>> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const params = new URLSearchParams(args.params);
  params.set('limit', String(normalizePageLimit(args.limit)));
  if (args.cursor) {
    params.set('cursor', args.cursor);
  } else {
    params.delete('cursor');
  }

  const query = params.toString();
  const response = await fetchImpl(query ? `${args.path}?${query}` : args.path, args.init);
  if (!response.ok) {
    throw new Error(args.errorMessage);
  }

  const pageSchema = apiCursorPageSchema(args.itemSchema ?? (z.unknown() as ZodType<T>), {
    allowAdditionalMeta: true,
  });
  const pagePayload = pageSchema.safeParse(await readJsonResponseBody(response));
  if (!pagePayload.success) {
    throw new Error(args.errorMessage);
  }

  return pagePayload.data;
}

export async function fetchAllCursorPages<T>(args: {
  path: string;
  params?: URLSearchParams;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
  errorMessage: string;
  itemSchema?: ZodType<T>;
}): Promise<CompleteCursorCollection<T>> {
  const maxPages = normalizeMaxPages(args.maxPages);
  const aggregated: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const pagePayload = await fetchCursorPage<T>({
      path: args.path,
      params: args.params,
      init: args.init,
      fetchImpl: args.fetchImpl,
      limit: args.limit,
      cursor,
      errorMessage: args.errorMessage,
      itemSchema: args.itemSchema,
    });

    aggregated.push(...pagePayload.data);
    if (!pagePayload.hasMore || !pagePayload.nextCursor) {
      cursor = undefined;
      break;
    }
    const nextCursor = pagePayload.nextCursor;
    if (seenCursors.has(nextCursor)) {
      throw new Error(args.errorMessage);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (cursor) {
    throw new Error(args.errorMessage);
  }

  return {
    data: aggregated,
    hasMore: false,
  };
}
