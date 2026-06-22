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

  it('encodes only the patient id path segment when fetching overview data', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        data: {
          patient: { id: '../settings?x=1#y', name: '青葉 花子' },
          link: null,
          profile: null,
          summary: null,
          messages: [],
          checkLogs: [],
        },
      }),
    } as Response);
    global.fetch = fetchMock;

    await fetchPatientMcsOverview('../settings?x=1#y', 'org_1', 0);

    expect(fetchMock).toHaveBeenCalledWith('/api/patients/..%2Fsettings%3Fx%3D1%23y/mcs?limit=0', {
      headers: { 'x-org-id': 'org_1' },
      cache: 'no-store',
    });

    global.fetch = originalFetch;
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

    await expect(fetchPatientMcsOverview('patient_1', 'org_1', 0)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'MCS 本文は権限のある担当者のみ表示できます。',
    } satisfies Partial<PatientMcsOverviewQueryError>);

    global.fetch = originalFetch;
  });

  it('uses the fallback forbidden message when an error response body is not JSON', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response('{"message":', { status: 403 }));

    await expect(fetchPatientMcsOverview('patient_1', 'org_1', 0)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'MCS 連携の閲覧権限がありません',
    } satisfies Partial<PatientMcsOverviewQueryError>);

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

  it('maps malformed successful payloads to a typed failed query error', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        data: {
          patient: { id: 'patient_1', name: '青葉 花子' },
          link: null,
          summary: null,
          messages: { id: 'message_1' },
        },
      }),
    } as Response);

    await expect(fetchPatientMcsOverview('patient_1', 'org_1', 30)).rejects.toMatchObject({
      code: 'failed',
      message: 'MCS 連携情報の取得に失敗しました',
    } satisfies Partial<PatientMcsOverviewQueryError>);

    global.fetch = originalFetch;
  });
});
