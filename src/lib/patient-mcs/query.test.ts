import { describe, expect, it, vi } from 'vitest';
import {
  createPatientMcsQueryKeyPrefix,
  createPatientMcsQueryKey,
  fetchPatientMcsOverview,
  PatientMcsOverviewQueryError,
} from './query';

describe('patient-mcs query', () => {
  it('builds a stable shared prefix key', () => {
    expect(createPatientMcsQueryKeyPrefix('patient_1', 'org_1')).toEqual([
      'patient-mcs',
      'patient_1',
      'org_1',
    ]);
  });

  it('builds a stable query key', () => {
    expect(createPatientMcsQueryKey('patient_1', 'org_1', 30)).toEqual([
      'patient-mcs',
      'patient_1',
      'org_1',
      30,
    ]);
  });

  it('maps forbidden responses to a typed query error', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({
        message: 'MCS 本文は権限のある担当者のみ表示できます。',
      }),
    } as Response);

    await expect(fetchPatientMcsOverview('patient_1', 'org_1', 0)).rejects.toMatchObject(
      {
        code: 'forbidden',
        message: 'MCS 本文は権限のある担当者のみ表示できます。',
      } satisfies Partial<PatientMcsOverviewQueryError>
    );

    global.fetch = originalFetch;
  });

  it('normalizes invalid limits and maps failed responses with the server message', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ message: 'MCS の取得に失敗しました' }),
    } as Response);
    global.fetch = fetchMock;

    await expect(fetchPatientMcsOverview('patient_1', 'org_1', -1)).rejects.toMatchObject({
      code: 'failed',
      message: 'MCS の取得に失敗しました',
    } satisfies Partial<PatientMcsOverviewQueryError>);
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/patient_1/mcs?limit=0', {
      headers: { 'x-org-id': 'org_1' },
      cache: 'no-store',
    });

    global.fetch = originalFetch;
  });
});
