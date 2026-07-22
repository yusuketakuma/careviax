// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/fetch-test-utils';
import { HOME_VISIT_SCHEDULING_PREFERENCE_KEYS } from '@/lib/patient/home-visit-intake-patch';

const { reflectionRows, cryptoState, encryptRequiredMock, decryptMock, reflectionTableMock } =
  vi.hoisted(() => {
    const rows: Array<{
      id?: number;
      orgId: string;
      scheduleId: string;
      recordId: string;
      payload: string;
      updatedAt: Date;
    }> = [];
    const table = {
      add: vi.fn(async (row: (typeof rows)[number]) => {
        rows.push({ ...row, id: rows.length + 1 });
        return rows.length;
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((values: string[]) => {
          const matching = () =>
            rows.filter((row) =>
              index === '[orgId+scheduleId]'
                ? row.orgId === values[0] && row.scheduleId === values[1]
                : row.orgId === values[0] &&
                  row.scheduleId === values[1] &&
                  row.recordId === values[2],
            );
          return {
            delete: vi.fn(async () => {
              for (const row of matching()) rows.splice(rows.indexOf(row), 1);
            }),
            reverse: () => ({ first: vi.fn(async () => matching().at(-1)) }),
          };
        }),
      })),
    };
    return {
      reflectionRows: rows,
      cryptoState: { plaintext: '' },
      encryptRequiredMock: vi.fn(),
      decryptMock: vi.fn(),
      reflectionTableMock: table,
    };
  });

vi.mock('@/lib/offline/crypto', () => ({
  encryptOfflinePayloadRequired: encryptRequiredMock,
  decryptOfflinePayload: decryptMock,
  isEncryptedOfflinePayload: (value: string) => value.startsWith('encv1:'),
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    visitReflectionContinuations: reflectionTableMock,
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      await callback();
    }),
  },
}));
import {
  buildPatientReflectionPayload,
  clearPatientReflectionContinuation,
  loadPatientReflectionContinuation,
  patchPatientReflection,
  persistPatientReflectionContinuation,
  requiresPatientReflectionCareCaseTarget,
} from './visit-patient-reflection';

const pending = {
  patientId: 'patient_1',
  sourceVisitRecordId: 'record_1',
  intake: { care_level: 'care_2' },
  expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
  careCaseId: 'case_1',
  expectedCareCaseVersion: 3,
};

function successEnvelope({
  patientId = pending.patientId,
  patientUpdatedAt = '2026-07-22T00:00:01.000Z',
  dataUpdatedAt = patientUpdatedAt,
  careCaseId = pending.careCaseId,
  careCaseVersion = pending.expectedCareCaseVersion! + 1,
}: {
  patientId?: string;
  patientUpdatedAt?: string;
  dataUpdatedAt?: string | undefined;
  careCaseId?: string | null;
  careCaseVersion?: number | null;
} = {}) {
  return {
    data: {
      id: patientId,
      ...(dataUpdatedAt === undefined ? {} : { updated_at: dataUpdatedAt }),
    },
    meta: {
      warnings: [],
      duplicate_candidates: [],
      version_basis: {
        patient_updated_at: patientUpdatedAt,
        care_case_id: careCaseId,
        care_case_version: careCaseVersion,
      },
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  reflectionRows.length = 0;
  cryptoState.plaintext = '';
  encryptRequiredMock.mockReset().mockImplementation(async (value: string) => {
    cryptoState.plaintext = value;
    return 'encv1:opaque-ciphertext';
  });
  decryptMock.mockReset().mockImplementation(async () => cryptoState.plaintext);
});

describe('visit patient reflection OCC', () => {
  it('builds the exact patient and canonical-case preconditions', () => {
    expect(buildPatientReflectionPayload(pending)).toEqual({
      intake: { care_level: 'care_2' },
      source_visit_record_id: 'record_1',
      expected_updated_at: '2026-07-22T00:00:00.000Z',
      care_case_id: 'case_1',
      expected_care_case_version: 3,
    });
  });

  it('classifies stale and transport failures without retrying automatically', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(patchPatientReflection(pending, 'org_1')).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(patchPatientReflection(pending, 'org_1')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts only a coherent strict Patient PATCH success envelope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successEnvelope()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(patchPatientReflection(pending, 'org_1')).resolves.toEqual({ ok: true });
  });

  it.each([
    ['unexpected root field', { ...successEnvelope(), extra: true }],
    [
      'unexpected data field',
      { ...successEnvelope(), data: { ...successEnvelope().data, name: 'x' } },
    ],
    ['patient mismatch', successEnvelope({ patientId: 'patient_2' })],
    [
      'case pair mismatch',
      successEnvelope({ careCaseId: pending.careCaseId, careCaseVersion: null }),
    ],
    ['canonical case mismatch', successEnvelope({ careCaseId: 'case_2' })],
    ['case version did not advance', successEnvelope({ careCaseVersion: 3 })],
    ['missing data timestamp', { ...successEnvelope(), data: { id: pending.patientId } }],
    [
      'patient token did not advance',
      successEnvelope({ patientUpdatedAt: pending.expectedUpdatedAt }),
    ],
    [
      'patient token moved backwards',
      successEnvelope({ patientUpdatedAt: '2026-07-21T23:59:59.000Z' }),
    ],
    ['patient timestamp mismatch', successEnvelope({ dataUpdatedAt: '2026-07-22T00:00:02.000Z' })],
    ['invalid patient timestamp', successEnvelope({ patientUpdatedAt: 'not-a-date' })],
  ])('keeps the continuation pending for malformed 2xx: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));

    await expect(patchPatientReflection(pending, 'org_1')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('rejects an incoherent requested case pair before issuing PATCH', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      patchPatientReflection({ ...pending, expectedCareCaseVersion: null }, 'org_1'),
    ).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses null case authority for A-only fields and requires canonical authority for B fields', () => {
    for (const key of HOME_VISIT_SCHEDULING_PREFERENCE_KEYS) {
      expect(requiresPatientReflectionCareCaseTarget({ [key]: 'value' })).toBe(false);
    }
    expect(requiresPatientReflectionCareCaseTarget({ medication_manager: 'family' })).toBe(true);
    expect(
      buildPatientReflectionPayload({
        ...pending,
        careCaseId: null,
        expectedCareCaseVersion: null,
      }),
    ).toMatchObject({ care_case_id: null, expected_care_case_version: null });
  });

  it('persists only encrypted IndexedDB payload under org/schedule/record identity', async () => {
    window.localStorage.setItem(
      'careviax:visit-patient-reflection:v1:schedule:schedule%2F1',
      'legacy-record',
    );
    window.localStorage.setItem('unrelated-preference', 'safe');
    await persistPatientReflectionContinuation('org_1', {
      scheduleId: 'schedule/1',
      reflection: pending,
      record: { id: 'record_1', version: 1, patient_id: 'patient_1' },
      status: 'stale',
    });

    expect(reflectionRows).toEqual([
      expect.objectContaining({
        orgId: 'org_1',
        scheduleId: 'schedule/1',
        recordId: 'record_1',
        payload: 'encv1:opaque-ciphertext',
      }),
    ]);
    expect(JSON.stringify(reflectionRows)).not.toContain('patient_1');
    expect(
      window.localStorage.getItem('careviax:visit-patient-reflection:v1:schedule:schedule%2F1'),
    ).toBeNull();
    expect(window.localStorage.getItem('unrelated-preference')).toBe('safe');
    expect(window.sessionStorage.length).toBe(0);
    await expect(loadPatientReflectionContinuation('org_1', 'schedule/1')).resolves.toEqual({
      kind: 'loaded',
      continuation: {
        scheduleId: 'schedule/1',
        reflection: pending,
        record: { id: 'record_1', version: 1, patient_id: 'patient_1' },
        status: 'stale',
      },
    });

    await clearPatientReflectionContinuation('org_1', 'schedule/1', 'record_1');
    await expect(loadPatientReflectionContinuation('org_1', 'schedule/1')).resolves.toBeNull();
  });

  it('fails closed without writing a row when encryption is unavailable', async () => {
    encryptRequiredMock.mockRejectedValueOnce(new Error('crypto unavailable'));

    await expect(
      persistPatientReflectionContinuation('org_1', {
        scheduleId: 'schedule_1',
        reflection: pending,
        record: { id: 'record_1', version: 1, patient_id: 'patient_1' },
        status: 'failed',
      }),
    ).rejects.toThrow('crypto unavailable');
    expect(reflectionRows).toHaveLength(0);
  });

  it('returns an unavailable sentinel when encrypted continuation cannot be decrypted', async () => {
    reflectionRows.push({
      id: 1,
      orgId: 'org_1',
      scheduleId: 'schedule_1',
      recordId: 'record_1',
      payload: 'encv1:opaque-ciphertext',
      updatedAt: new Date(),
    });
    decryptMock.mockResolvedValueOnce(null);

    await expect(loadPatientReflectionContinuation('org_1', 'schedule_1')).resolves.toEqual({
      kind: 'unavailable',
      recordId: 'record_1',
    });
  });

  it('never consumes a plaintext IndexedDB continuation row', async () => {
    reflectionRows.push({
      id: 1,
      orgId: 'org_1',
      scheduleId: 'schedule_1',
      recordId: 'record_1',
      payload: JSON.stringify({ patientId: 'patient_1' }),
      updatedAt: new Date(),
    });

    await expect(loadPatientReflectionContinuation('org_1', 'schedule_1')).resolves.toEqual({
      kind: 'unavailable',
      recordId: 'record_1',
    });
    expect(decryptMock).not.toHaveBeenCalled();
  });
});
