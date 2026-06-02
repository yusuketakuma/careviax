import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  below: vi.fn(),
  get: vi.fn(),
  toArray: vi.fn(),
  where: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  decryptOfflinePayload: vi.fn(),
  encryptOfflinePayloadRequired: vi.fn(),
}));

vi.mock('@/lib/offline/crypto', () => ({
  decryptOfflinePayload: cryptoMocks.decryptOfflinePayload,
  encryptOfflinePayloadRequired: cryptoMocks.encryptOfflinePayloadRequired,
}));

vi.mock('./offline-db', () => ({
  offlineDb: {
    syncQueue: {
      add: dbMocks.add,
      update: dbMocks.update,
      delete: dbMocks.delete,
      get: dbMocks.get,
      where: dbMocks.where,
    },
    visitDrafts: {
      where: vi.fn(),
    },
  },
}));

import { enqueueForSync, overwriteVisitRecordConflict, processSyncQueue } from './sync-engine';

describe('sync-engine PHI persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
    dbMocks.add.mockResolvedValue(1);
    dbMocks.update.mockResolvedValue(1);
    dbMocks.get.mockResolvedValue(null);
    dbMocks.below.mockReturnValue({ toArray: dbMocks.toArray });
    dbMocks.where.mockReturnValue({ below: dbMocks.below });
    dbMocks.toArray.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('encrypts sync queue payloads with the fail-closed helper before writing', async () => {
    await enqueueForSync('visit_record', {
      schedule_id: 'schedule-1',
      soap_subjective: '患者名 山田太郎 強い眠気あり',
    });

    expect(cryptoMocks.encryptOfflinePayloadRequired).toHaveBeenCalledWith(
      expect.stringContaining('患者名 山田太郎'),
      'sync queue visit_record payload',
    );
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'visit_record',
        payload: 'encv1:sync queue visit_record payload:sealed',
        scope_id: 'schedule-1',
      }),
    );
  });

  it('does not write PHI to the sync queue when encryption is unavailable', async () => {
    cryptoMocks.encryptOfflinePayloadRequired.mockRejectedValue(
      Object.assign(new Error('missing offline encryption key'), {
        name: 'OfflineEncryptionUnavailableError',
      }),
    );

    await expect(
      enqueueForSync('residual_medication', {
        patient_id: 'patient-1',
        drug_name: '高血圧薬A',
      }),
    ).rejects.toMatchObject({
      name: 'OfflineEncryptionUnavailableError',
    });

    expect(dbMocks.add).not.toHaveBeenCalled();
  });

  it('marks malformed decrypted sync payloads failed without sending them to the server', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 9,
        entityType: 'visit_record',
        payload: 'encv1:broken-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 1,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:broken-sync-payload') return 'not-json';
        return value ?? null;
      },
    );

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith(9, {
      retryCount: 2,
      lastError: 'Invalid sync payload',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
  });

  it('marks non-object decrypted sync payloads failed without sending them to the server', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 12,
        entityType: 'visit_record',
        payload: 'encv1:array-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:array-sync-payload') return JSON.stringify(['unexpected']);
        return value ?? null;
      },
    );

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith(12, {
      retryCount: 1,
      lastError: 'Invalid sync payload',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
  });

  it('drops malformed server conflict responses before persisting conflict snapshots', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 10,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-sync-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          details: {
            existing_record: {
              id: 123,
              version: 'bad-version',
              patient_id: 'patient-1',
              visit_date: '2026-04-01',
              outcome_status: 'draft',
            },
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    const conflictEncryptCall = cryptoMocks.encryptOfflinePayloadRequired.mock.calls.find(
      ([, context]) => context === 'sync queue conflict payload',
    );
    expect(conflictEncryptCall).toBeDefined();
    expect(JSON.parse(conflictEncryptCall![0] as string)).toEqual({
      local: { schedule_id: 'schedule-1', soap_subjective: '眠気あり' },
      server: null,
    });
    expect(dbMocks.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        retryCount: 3,
        conflict_state: 'server_conflict',
      }),
    );
  });

  it('drops unparseable server conflict responses before persisting conflict snapshots', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 13,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-sync-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"details":', {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    const conflictEncryptCall = cryptoMocks.encryptOfflinePayloadRequired.mock.calls.find(
      ([, context]) => context === 'sync queue conflict payload',
    );
    expect(conflictEncryptCall).toBeDefined();
    expect(JSON.parse(conflictEncryptCall![0] as string)).toEqual({
      local: { schedule_id: 'schedule-1', soap_subjective: '眠気あり' },
      server: null,
    });
    expect(dbMocks.update).toHaveBeenCalledWith(
      13,
      expect.objectContaining({
        retryCount: 3,
        conflict_state: 'server_conflict',
      }),
    );
  });

  it('does not overwrite when the stored conflict server snapshot is malformed', async () => {
    dbMocks.get.mockResolvedValue({
      id: 11,
      entityType: 'visit_record',
      payload: 'encv1:valid-sync-payload',
      conflict_payload: 'encv1:malformed-conflict-payload',
      scope_id: 'schedule-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      retryCount: 3,
      conflict_state: 'server_conflict',
    });
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-sync-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        if (value === 'encv1:malformed-conflict-payload') {
          return JSON.stringify({
            local: { schedule_id: 'schedule-1', soap_subjective: '眠気あり' },
            server: {
              id: 'visit-record-1',
              version: 'bad-version',
              patient_id: 'patient-1',
              visit_date: '2026-04-01',
              outcome_status: 'draft',
            },
          });
        }
        return value ?? null;
      },
    );

    await expect(
      overwriteVisitRecordConflict({ orgId: 'org-1', endpoints: {} }, 11),
    ).resolves.toEqual({
      ok: false,
      message: '競合情報が不足しています',
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
