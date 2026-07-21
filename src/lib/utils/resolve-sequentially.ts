type SequentialResults<T extends readonly (() => unknown)[]> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

export async function resolveSequentially<const T extends readonly (() => unknown)[]>(tasks: T) {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as SequentialResults<T>;
}
