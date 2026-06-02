const DEFAULT_MAX_TIMEOUT_MS = 60_000;

export function normalizePositiveTimeoutMs(
  value: unknown,
  options: {
    fallbackMs: number;
    maxMs?: number;
  },
) {
  const parsedFallback = Math.trunc(options.fallbackMs);
  const fallbackMs =
    Number.isSafeInteger(parsedFallback) && parsedFallback > 0
      ? parsedFallback
      : DEFAULT_MAX_TIMEOUT_MS;
  const parsedMax = Math.trunc(options.maxMs ?? DEFAULT_MAX_TIMEOUT_MS);
  const maxMs =
    Number.isSafeInteger(parsedMax) && parsedMax > 0
      ? Math.max(parsedMax, fallbackMs)
      : DEFAULT_MAX_TIMEOUT_MS;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallbackMs;

  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) return fallbackMs;

  return Math.min(normalized, maxMs);
}
