export const PATIENT_DETAIL_QUERY_CONCURRENCY = 4;

type PatientDetailTasks = Record<string, () => Promise<unknown>>;
type PatientDetailTaskResults<TTasks extends PatientDetailTasks> = {
  [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>>;
};
export type PatientDetailTaskFailure<TTaskKey extends string = string> = {
  key: TTaskKey;
  error: unknown;
};

function normalizeConcurrency(concurrency: number, taskCount: number) {
  return Math.min(taskCount, Math.max(1, Math.trunc(concurrency) || 1));
}

export async function runPatientDetailTasks<const TTasks extends PatientDetailTasks>(
  tasks: TTasks,
  concurrency = PATIENT_DETAIL_QUERY_CONCURRENCY,
): Promise<PatientDetailTaskResults<TTasks>> {
  const entries = Object.entries(tasks) as Array<[keyof TTasks, TTasks[keyof TTasks]]>;
  if (entries.length === 0) {
    return {} as PatientDetailTaskResults<TTasks>;
  }

  const workerCount = normalizeConcurrency(concurrency, entries.length);
  const results: Partial<PatientDetailTaskResults<TTasks>> = {};
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const [key, task] = entries[currentIndex]!;
        results[key] = (await task()) as PatientDetailTaskResults<TTasks>[keyof TTasks];
      }
    }),
  );

  return results as PatientDetailTaskResults<TTasks>;
}

export async function runPatientDetailTasksSettled<const TTasks extends PatientDetailTasks>(
  tasks: TTasks,
  fallbacks: PatientDetailTaskResults<TTasks>,
  options: {
    concurrency?: number;
    onTaskError?: (failure: PatientDetailTaskFailure<Extract<keyof TTasks, string>>) => void;
  } = {},
): Promise<{
  results: PatientDetailTaskResults<TTasks>;
  failures: Array<PatientDetailTaskFailure<Extract<keyof TTasks, string>>>;
}> {
  const entries = Object.entries(tasks) as Array<[keyof TTasks, TTasks[keyof TTasks]]>;
  if (entries.length === 0) {
    return { results: {} as PatientDetailTaskResults<TTasks>, failures: [] };
  }

  const workerCount = normalizeConcurrency(
    options.concurrency ?? PATIENT_DETAIL_QUERY_CONCURRENCY,
    entries.length,
  );
  const results: Partial<PatientDetailTaskResults<TTasks>> = {};
  const failures: Array<PatientDetailTaskFailure<Extract<keyof TTasks, string>>> = [];
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const [key, task] = entries[currentIndex]!;
        try {
          results[key] = (await task()) as PatientDetailTaskResults<TTasks>[keyof TTasks];
        } catch (error) {
          const failure = {
            key: String(key) as Extract<keyof TTasks, string>,
            error,
          };
          failures.push(failure);
          options.onTaskError?.(failure);
          results[key] = fallbacks[key];
        }
      }
    }),
  );

  return {
    results: results as PatientDetailTaskResults<TTasks>,
    failures,
  };
}
