import { z, type ZodType } from 'zod';
import { apiCursorPageSchema, type CursorPaginatedPage } from './response-schemas';
import { readJsonResponseBody } from './response-body';

export const CURSOR_PAGINATION_PAGE_LIMIT = 100;

function normalizePageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return CURSOR_PAGINATION_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), CURSOR_PAGINATION_PAGE_LIMIT);
}

function normalizeMaxPages(maxPages: number | undefined) {
  if (maxPages === undefined || !Number.isFinite(maxPages)) return 20;
  return Math.max(Math.trunc(maxPages), 1);
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
}): Promise<CursorPaginatedPage<T>> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const limit = normalizePageLimit(args.limit);
  const maxPages = normalizeMaxPages(args.maxPages);
  const aggregated: T[] = [];
  let cursor: string | undefined;
  const pageSchema = apiCursorPageSchema(args.itemSchema ?? (z.unknown() as ZodType<T>), {
    allowAdditionalMeta: true,
  });

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams(args.params);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    const response = await fetchImpl(query ? `${args.path}?${query}` : args.path, args.init);
    if (!response.ok) {
      throw new Error(args.errorMessage);
    }

    const pagePayload = pageSchema.safeParse(await readJsonResponseBody(response));
    if (!pagePayload.success) {
      throw new Error(args.errorMessage);
    }

    aggregated.push(...pagePayload.data.data);
    if (!pagePayload.data.hasMore || !pagePayload.data.nextCursor) {
      cursor = undefined;
      break;
    }
    cursor = pagePayload.data.nextCursor;
  }

  return {
    data: aggregated,
    hasMore: Boolean(cursor),
    ...(cursor ? { nextCursor: cursor } : {}),
  };
}
