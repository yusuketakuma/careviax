import { labelForPath } from '@/lib/navigation/route-labels';

export const RECENT_OPERATIONS_KEY = 'ph-os:recent-operations';

export type RecentOperation = {
  href: string;
  label: string;
  visitedAt: string;
};

function isValidVisitedAt(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function readRecentOperation(value: unknown): RecentOperation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.href !== 'string' ||
    !candidate.href.startsWith('/') ||
    typeof candidate.label !== 'string' ||
    candidate.label.trim() === '' ||
    typeof candidate.visitedAt !== 'string' ||
    !isValidVisitedAt(candidate.visitedAt)
  ) {
    return null;
  }

  return {
    href: candidate.href,
    label: candidate.label,
    visitedAt: candidate.visitedAt,
  };
}

export function normalizeRecentOperations(value: unknown): RecentOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const operation = readRecentOperation(item);
    return operation ? [operation] : [];
  });
}

export function parseRecentOperationsStorage(raw: string | null | undefined) {
  if (!raw) {
    return [];
  }

  try {
    return normalizeRecentOperations(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function prependRecentOperation(
  operations: RecentOperation[],
  pathname: string,
  visitedAt = new Date(),
) {
  if (!pathname.startsWith('/')) {
    return operations;
  }

  const nextItem: RecentOperation = {
    href: pathname,
    label: labelForPath(pathname),
    visitedAt: visitedAt.toISOString(),
  };

  return [nextItem, ...operations.filter((item) => item.href !== pathname)].slice(0, 8);
}
