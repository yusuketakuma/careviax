import { describe, expect, it, vi } from 'vitest';
import {
  fetchPatientVisitRecordsWindow,
  VISIT_RECORD_PAGE_LIMIT,
} from './patient-visit-records.helpers';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('patient-visit-records.helpers', () => {
  it('collects all visit-record pages for a patient', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'record_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'record_2' }],
          hasMore: false,
        }),
      );

    const records = await fetchPatientVisitRecordsWindow<{ id: string }>({
      orgId: 'org_1',
      patientId: 'patient_1',
      fetchImpl,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(records).toEqual([{ id: 'record_1' }, { id: 'record_2' }]);
  });

  it('caps the page size to the API maximum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        hasMore: false,
      }),
    );

    await fetchPatientVisitRecordsWindow({
      orgId: 'org_1',
      patientId: 'patient_1',
      fetchImpl,
      limit: VISIT_RECORD_PAGE_LIMIT + 25,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${VISIT_RECORD_PAGE_LIMIT}`),
      expect.any(Object),
    );
  });

  it('passes the org header through to the cursor fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        hasMore: false,
      }),
    );

    await fetchPatientVisitRecordsWindow({
      orgId: 'org_42',
      patientId: 'patient_1',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_42');
  });
});
