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

type SequentialTask = () => unknown;
type SequentialResults<Tasks extends readonly SequentialTask[]> = {
  [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>;
};

/**
 * Executes heterogeneous async work in declaration order.
 *
 * Interactive transaction clients backed by a single database connection must
 * not receive overlapping queries. This helper preserves tuple result types
 * without constructing every query promise up front.
 */
export async function runSequentially<const Tasks extends readonly SequentialTask[]>(
  tasks: Tasks,
): Promise<SequentialResults<Tasks>> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as SequentialResults<Tasks>;
}
