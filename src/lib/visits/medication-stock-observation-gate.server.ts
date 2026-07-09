import 'server-only';

export const VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV =
  'PHOS_ENABLE_VISIT_MEDICATION_STOCK_OBSERVATIONS';

export const VISIT_MEDICATION_STOCK_OBSERVATION_DISABLED_CODE =
  'MEDICATION_STOCK_OBSERVATION_DISABLED';

export const VISIT_MEDICATION_STOCK_OBSERVATION_DISABLED_MESSAGE =
  '残数観測の登録機能はDB連携確認中です。従来の残薬記録を使用してください。';

function isExplicitlyTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function isVisitMedicationStockObservationWriteEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return isExplicitlyTrue(env[VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV]);
}
