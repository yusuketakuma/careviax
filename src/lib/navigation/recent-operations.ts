import { labelForPath } from '@/lib/navigation/route-labels';
import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';

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
  const candidate = readJsonObject(value);
  if (!candidate) return null;
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
  return normalizeRecentOperations(parseJsonOrNull(raw));
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
