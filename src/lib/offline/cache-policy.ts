export const OFFLINE_CACHE_TTL_HOURS = 24;
export const OFFLINE_CACHE_TTL_MS = OFFLINE_CACHE_TTL_HOURS * 60 * 60 * 1000;

export function isOfflineCacheFresh(
  updatedAt: Date | string | null | undefined,
  ttlMs: number = OFFLINE_CACHE_TTL_MS
) {
  if (!updatedAt) return false;

  const timestamp =
    updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();

  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= ttlMs;
}

export function formatOfflineCacheUpdatedAt(
  updatedAt: Date | string | null | undefined
) {
  if (!updatedAt) return null;

  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}
