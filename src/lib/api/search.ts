export function buildSearchFilter(query: string | undefined, fields: string[]) {
  const term = query?.trim();
  if (!term) return {};
  return {
    OR: fields.map((field) => ({
      [field]: { contains: term, mode: 'insensitive' as const },
    })),
  };
}

const DEFAULT_MAX_PAGE = 10_000;

export function buildPagination(page?: number, limit?: number, maxPage = DEFAULT_MAX_PAGE) {
  const normalizedPage = Number.isFinite(page) ? Math.trunc(page as number) : 1;
  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit as number) : 20;
  const p = Math.min(Math.max(1, normalizedPage), maxPage);
  const l = Math.min(100, Math.max(1, normalizedLimit));
  return { skip: (p - 1) * l, take: l };
}

export function buildSort(
  sort?: string,
  order?: 'asc' | 'desc',
  allowed: string[] = [],
  fallback?: string,
) {
  const resolvedSort = sort && (allowed.length === 0 || allowed.includes(sort)) ? sort : fallback;
  if (!resolvedSort) return undefined;
  return { [resolvedSort]: order ?? 'asc' };
}
