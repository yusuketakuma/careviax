import { describe, expect, it, vi } from 'vitest';
import {
  fetchPatientVisitRecordsWindow,
  VISIT_RECORD_PAGE_LIMIT,
} from './patient-visit-records.helpers';

describe('patient-visit-records.helpers', () => {
  it('collects all visit-record pages for a patient', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'record_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'record_2' }],
          hasMore: false,
        }),
      });

    const records = await fetchPatientVisitRecordsWindow<{ id: string }>({
      orgId: 'org_1',
      patientId: 'patient_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(records).toEqual([{ id: 'record_1' }, { id: 'record_2' }]);
  });

  it('caps the page size to the API maximum', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        hasMore: false,
      }),
    });

    await fetchPatientVisitRecordsWindow({
      orgId: 'org_1',
      patientId: 'patient_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: VISIT_RECORD_PAGE_LIMIT + 25,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${VISIT_RECORD_PAGE_LIMIT}`),
      expect.any(Object),
    );
  });
});
