import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import {
  createPatientMcsQueryKeyPrefix,
  createPatientMcsQueryKey,
  fetchPatientMcsOverview,
  PatientMcsOverviewQueryError,
} from './query';

// Actual-backed spy so header-identity tests can prove helper adoption via return-value identity
// while the other tests keep the real { 'x-org-id': orgId } shape.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

describe('patient-mcs query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('keeps the raw patient id in query keys even when it is path-hostile', () => {
    // raw id flows verbatim into the cache key; only the URL gets encoded (asserted below)
    expect(createPatientMcsQueryKeyPrefix('pt/1?x=y#z', 'org_1')).toEqual([
      'patient-mcs',
      'pt/1?x=y#z',
      'org_1',
    ]);
    expect(createPatientMcsQueryKey('pt/1?x=y#z', 'org_1', 30)).toEqual([
      'patient-mcs',
      'pt/1?x=y#z',
      'org_1',
      30,
    ]);
  });

  it('single-encodes only the patient id path segment and adopts the org-header helper', async () => {
    const originalFetch = global.fetch;
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValueOnce(sentinelHeaders);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        data: {
          patient: { id: 'pt/1?x=y#z', name: '青葉 花子' },
          link: null,
          profile: null,
          summary: null,
          messages: [],
          checkLogs: [],
        },
      }),
    } as Response);
    global.fetch = fetchMock;

    await fetchPatientMcsOverview('pt/1?x=y#z', 'org_1', 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // exact single-encode of the hostile id; raw ? / # never leak into the path
    expect(url).toBe('/api/patients/pt%2F1%3Fx%3Dy%23z/mcs?limit=0');
    expect(url).not.toContain('%25'); // no double-encoding
    // helper-return identity (toBe), not an equal-shaped literal; helper called once with the real org
    expect(init.headers).toBe(sentinelHeaders);
    expect(init.cache).toBe('no-store');
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');

    global.fetch = originalFetch;
  });

  it.each(['.', '..'])(
    'rejects the exact dot segment %p with a RangeError before calling fetch',
    async (hostileId) => {
      const originalFetch = global.fetch;
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await expect(fetchPatientMcsOverview(hostileId, 'org_1', 0)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(fetchMock).not.toHaveBeenCalled();

      global.fetch = originalFetch;
    },
  );

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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/patients/patient_1/mcs?limit=0');
    expect(init.headers).toEqual({ 'x-org-id': 'org_1' });
    expect(init.cache).toBe('no-store');

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
