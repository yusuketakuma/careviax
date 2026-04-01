export type CursorPaginatedPage<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
};

export const CURSOR_PAGINATION_PAGE_LIMIT = 100;

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
}): Promise<TPage> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const limit = Math.min(args.limit ?? CURSOR_PAGINATION_PAGE_LIMIT, CURSOR_PAGINATION_PAGE_LIMIT);
  const maxPages = args.maxPages ?? 20;
  const aggregated: T[] = [];
  let cursor: string | undefined;
  let firstPage: TPage | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams(args.params);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    const response = await fetchImpl(
      query ? `${args.path}?${query}` : args.path,
      args.init,
    );
    if (!response.ok) {
      throw new Error(args.errorMessage);
    }

    const payload = (await response.json()) as TPage;
    firstPage ??= payload;
    aggregated.push(...(payload.data ?? []));

    if (!payload.hasMore || !payload.nextCursor) {
      break;
    }
    cursor = payload.nextCursor;
  }

  return {
    ...(firstPage ?? ({ data: [], hasMore: false } as unknown as TPage)),
    data: aggregated,
    hasMore: false,
    nextCursor: undefined,
  };
}
