import type { PatientMcsSyncViewResult } from './dto';

export function buildPatientMcsSyncToastMessage(
  result: PatientMcsSyncViewResult,
  label: string
) {
  const prefix =
    result.importedCount > 0
      ? `${label}から ${result.importedCount} 件同期しました`
      : `${label}を同期しました`;

  const headline = result.summary?.headline?.trim();
  return headline ? `${prefix}。${headline}` : prefix;
}
