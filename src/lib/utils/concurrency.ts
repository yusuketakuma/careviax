export function normalizeConcurrencyLimit(
  value: unknown,
  options: { defaultValue: number; max: number },
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return options.defaultValue;
  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) return options.defaultValue;
  return Math.min(normalized, options.max);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Number.isFinite(concurrency) ? Math.trunc(concurrency) : 1),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}
