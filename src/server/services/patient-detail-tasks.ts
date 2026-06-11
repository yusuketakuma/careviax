export const PATIENT_DETAIL_QUERY_CONCURRENCY = 4;

type PatientDetailTasks = Record<string, () => Promise<unknown>>;
type PatientDetailTaskResults<TTasks extends PatientDetailTasks> = {
  [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>>;
};

export async function runPatientDetailTasks<const TTasks extends PatientDetailTasks>(
  tasks: TTasks,
  concurrency = PATIENT_DETAIL_QUERY_CONCURRENCY,
): Promise<PatientDetailTaskResults<TTasks>> {
  const entries = Object.entries(tasks) as Array<[keyof TTasks, TTasks[keyof TTasks]]>;
  if (entries.length === 0) {
    return {} as PatientDetailTaskResults<TTasks>;
  }

  const workerCount = Math.min(entries.length, Math.max(1, Math.trunc(concurrency) || 1));
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
