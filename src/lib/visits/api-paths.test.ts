import { describe, expect, it } from 'vitest';

import {
  buildVisitMedicationStockObservationsApiPath,
  buildVisitRecordApiPath,
  buildVisitReflectedFieldsApiPath,
  buildVisitScheduleApiPath,
} from './api-paths';

describe('visit API path helpers', () => {
  it('builds encoded visit record and schedule paths', () => {
    const id = 'visit/1?mode=x#fragment';
    expect(buildVisitRecordApiPath(id)).toBe(`/api/visit-records/${encodeURIComponent(id)}`);
    expect(buildVisitScheduleApiPath(id)).toBe(`/api/visit-schedules/${encodeURIComponent(id)}`);
  });

  it.each(['.', '..'])('rejects exact dot-segment record and schedule id %s', (id) => {
    expect(() => buildVisitRecordApiPath(id)).toThrow(RangeError);
    expect(() => buildVisitScheduleApiPath(id)).toThrow(RangeError);
  });

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

  it('builds an encoded reflected-fields path', () => {
    const id = 'visit/1?mode=x#fragment';
    expect(buildVisitReflectedFieldsApiPath(id)).toBe(
      `/api/visit-records/${encodeURIComponent(id)}/reflected-fields`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment reflected-fields id %s', (id) => {
    expect(() => buildVisitReflectedFieldsApiPath(id)).toThrow(RangeError);
  });
});
