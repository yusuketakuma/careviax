import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isVisitMedicationStockObservationWriteEnabled,
  VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV,
} from './medication-stock-observation-gate.server';

describe('visit medication stock observation write gate', () => {
  it('uses the documented PH-OS server-side deployment gate', () => {
    expect(VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV).toBe(
      'PHOS_ENABLE_VISIT_MEDICATION_STOCK_OBSERVATIONS',
    );
  });

  it('fails closed when the deployment gate is missing or malformed', () => {
    expect(isVisitMedicationStockObservationWriteEnabled({})).toBe(false);
    expect(
      isVisitMedicationStockObservationWriteEnabled({
        [VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV]: 'yes',
      }),
    ).toBe(false);
  });

  it('enables writes only for the explicit release values', () => {
    expect(
      isVisitMedicationStockObservationWriteEnabled({
        [VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV]: 'true',
      }),
    ).toBe(true);
    expect(
      isVisitMedicationStockObservationWriteEnabled({
        [VISIT_MEDICATION_STOCK_OBSERVATION_WRITE_ENV]: '1',
      }),
    ).toBe(true);
  });
});
