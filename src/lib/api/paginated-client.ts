import { readJsonObject } from '@/lib/db/json';

type CursorPaginatedResponse<T, Extra extends object = Record<string, never>> = Extra & {
  data?: T[];
  hasMore?: boolean;
  nextCursor?: string;
};

export const CURSOR_PAGE_LIMIT = 100;

type NormalizedCursorResponse<T, Extra extends object> = {
  page: {
    data: T[];
    hasMore: boolean;
    nextCursor?: string;
  };
  extra: Extra;
};

function normalizeCursorResponse<T, Extra extends object>(
  payload: unknown,
): NormalizedCursorResponse<T, Extra> | null {
  const object = readJsonObject(payload);
  if (!object) return null;

  const data = object.data ?? [];
  const hasMore = object.hasMore ?? false;
  if (!Array.isArray(data)) return null;
  if (typeof hasMore !== 'boolean') return null;
  if (object.nextCursor !== undefined && typeof object.nextCursor !== 'string') return null;

  const { data: _data, hasMore: _hasMore, nextCursor, ...rest } = object;
  void _data;
  void _hasMore;

  return {
    page: {
      data: data as T[],
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    },
    extra: rest as Extra,
  };
}

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

    const normalized = normalizeCursorResponse<T, Extra>((await response.json()) as unknown);
    if (!normalized) {
      throw new Error('一覧データの取得に失敗しました');
    }

    const { data, hasMore, nextCursor } = normalized.page;
    if (extra == null) {
      extra = normalized.extra;
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
