type CursorPaginatedResponse<T, Extra extends object = Record<string, never>> = Extra & {
  data?: T[];
  hasMore?: boolean;
  nextCursor?: string;
};

export const CURSOR_PAGE_LIMIT = 100;

export async function fetchAllCursorPages<T, Extra extends object = Record<string, never>>(args: {
  path: string;
  orgId: string;
  params?: URLSearchParams;
  fetchImpl?: typeof fetch;
  init?: RequestInit;
  limit?: number;
  maxPages?: number;
}) {
  const fetchImpl = args.fetchImpl ?? fetch;
  const limit = Math.min(args.limit ?? CURSOR_PAGE_LIMIT, CURSOR_PAGE_LIMIT);
  const maxPages = args.maxPages ?? 20;
  const collected: T[] = [];
  let cursor: string | undefined;
  let extra: Extra | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams(args.params);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);

    const response = await fetchImpl(`${args.path}?${params.toString()}`, {
      ...args.init,
      headers: {
        ...(args.init?.headers ?? {}),
        'x-org-id': args.orgId,
      },
    });
    if (!response.ok) {
      throw new Error('一覧データの取得に失敗しました');
    }

    const json = (await response.json()) as CursorPaginatedResponse<T, Extra>;
    const { data = [], hasMore = false, nextCursor, ...rest } = json;
    if (extra == null) {
      extra = rest as Extra;
    }
    collected.push(...data);

    if (!hasMore || !nextCursor) {
      return {
        ...(extra ?? ({} as Extra)),
        data: collected,
        hasMore: false,
        nextCursor: undefined,
      } satisfies CursorPaginatedResponse<T, Extra>;
    }

    cursor = nextCursor;
  }

  return {
    ...(extra ?? ({} as Extra)),
    data: collected,
    hasMore: true,
    nextCursor: cursor,
  } satisfies CursorPaginatedResponse<T, Extra>;
}
