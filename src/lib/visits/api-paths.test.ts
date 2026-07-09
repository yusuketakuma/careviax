import { describe, expect, it } from 'vitest';

import { buildVisitMedicationStockObservationsApiPath } from './api-paths';

describe('visit API path helpers', () => {
  it('builds the medication stock observation path', () => {
    expect(buildVisitMedicationStockObservationsApiPath('visit_record_1')).toBe(
      '/api/visit-records/visit_record_1/medication-stock-observations',
    );
  });

  it('encodes hostile visit record ids as one path segment', () => {
    const id = 'visit/1?mode=x#fragment';
    expect(buildVisitMedicationStockObservationsApiPath(id)).toBe(
      `/api/visit-records/${encodeURIComponent(id)}/medication-stock-observations`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment visit record id %s', (id) => {
    expect(() => buildVisitMedicationStockObservationsApiPath(id)).toThrow(RangeError);
  });
});
