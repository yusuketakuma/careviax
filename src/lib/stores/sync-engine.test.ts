import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  below: vi.fn(),
  get: vi.fn(),
  deleteVisitDrafts: vi.fn(),
  equalsVisitDrafts: vi.fn(),
  whereVisitDrafts: vi.fn(),
  transaction: vi.fn(),
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
    transaction: dbMocks.transaction,
    syncQueue: {
      add: dbMocks.add,
      update: dbMocks.update,
      delete: dbMocks.delete,
      get: dbMocks.get,
      where: dbMocks.where,
    },
    visitDrafts: {
      where: dbMocks.whereVisitDrafts,
    },
  },
}));

import {
  enqueueForSync,
  overwriteVisitRecordConflict,
  processSyncQueue,
  setupAutoSync,
} from './sync-engine';

async function waitForAsyncAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe('sync-engine PHI persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
    dbMocks.add.mockResolvedValue(1);
    dbMocks.update.mockResolvedValue(1);
    dbMocks.below.mockReturnValue({ toArray: dbMocks.toArray });
    dbMocks.where.mockReturnValue({ below: dbMocks.below });
    dbMocks.equalsVisitDrafts.mockReturnValue({ delete: dbMocks.deleteVisitDrafts });
    dbMocks.whereVisitDrafts.mockReturnValue({ equals: dbMocks.equalsVisitDrafts });
    dbMocks.transaction.mockImplementation(
      async (
        _mode: string,
        _syncQueueTable: unknown,
        _visitDraftsTable: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
    );
    dbMocks.toArray.mockResolvedValue([]);
    dbMocks.get.mockImplementation(async (id: number) => {
      const items = await dbMocks.toArray();
      return Array.isArray(items) ? (items.find((item) => item.id === id) ?? null) : null;
    });
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

  it('single-flights concurrent sync queue processing for the same org and endpoints', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 21,
        entityType: 'residual_medication',
        payload: 'encv1:valid-residual-payload',
        scope_id: 'patient-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-residual-payload') {
          return JSON.stringify({ patient_id: 'patient-1', note: '残薬あり' });
        }
        return value ?? null;
      },
    );

    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const config = { orgId: 'org-1', endpoints: { residual_medication: '/api/residuals' } };
    const first = processSyncQueue(config);
    const second = processSyncQueue(config);

    await waitForAsyncAssertion(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    resolveFetch(new Response(JSON.stringify({ data: { id: 'server-1' } }), { status: 201 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { synced: 1, failed: 0 },
      { synced: 1, failed: 0 },
    ]);
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
    expect(dbMocks.delete).toHaveBeenCalledWith(21);
  });

  it('single-flights sync processing when default endpoints are implicit or explicit', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 26,
        entityType: 'visit_record',
        payload: 'encv1:valid-visit-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-visit-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        return value ?? null;
      },
    );

    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = processSyncQueue({ orgId: 'org-1', endpoints: {} });
    const second = processSyncQueue({
      orgId: 'org-1',
      endpoints: { visit_record: '/api/visit-records' },
    });

    await waitForAsyncAssertion(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    resolveFetch(new Response(JSON.stringify({ data: { id: 'record-1' } }), { status: 201 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { synced: 1, failed: 0 },
      { synced: 1, failed: 0 },
    ]);
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
    expect(dbMocks.delete).toHaveBeenCalledWith(26);
  });

  it('shares one automatic online listener for equivalent sync configs', () => {
    const addEventListenerMock = vi.fn();
    const removeEventListenerMock = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    });

    const unsubscribeFirst = setupAutoSync({ orgId: 'org-1', endpoints: {} });
    const unsubscribeSecond = setupAutoSync({
      orgId: 'org-1',
      endpoints: { visit_record: '/api/visit-records' },
    });

    expect(addEventListenerMock).toHaveBeenCalledTimes(1);
    expect(addEventListenerMock).toHaveBeenCalledWith('online', expect.any(Function));

    unsubscribeSecond();
    unsubscribeSecond();
    expect(removeEventListenerMock).not.toHaveBeenCalled();

    unsubscribeFirst();
    expect(removeEventListenerMock).toHaveBeenCalledTimes(1);
    expect(removeEventListenerMock).toHaveBeenCalledWith(
      'online',
      addEventListenerMock.mock.calls[0]![1],
    );
  });

  it('deletes the scoped visit draft only when the completed queue item is still current', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.toArray.mockResolvedValue([
      {
        id: 22,
        entityType: 'visit_record',
        payload: 'encv1:valid-visit-payload',
        scope_id: 'schedule-1',
        createdAt,
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-visit-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 1,
      failed: 0,
    });

    expect(dbMocks.delete).toHaveBeenCalledWith(22);
    expect(dbMocks.whereVisitDrafts).toHaveBeenCalledWith('scheduleId');
    expect(dbMocks.equalsVisitDrafts).toHaveBeenCalledWith('schedule-1');
    expect(dbMocks.deleteVisitDrafts).toHaveBeenCalledTimes(1);
  });

  it('does not delete a refreshed queue item or draft after an older visit payload succeeds', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.toArray.mockResolvedValue([
      {
        id: 23,
        entityType: 'visit_record',
        payload: 'encv1:old-visit-payload',
        scope_id: 'schedule-1',
        createdAt,
        retryCount: 0,
      },
    ]);
    dbMocks.get.mockResolvedValue({
      id: 23,
      entityType: 'visit_record',
      payload: 'encv1:new-visit-payload',
      scope_id: 'schedule-1',
      createdAt: new Date('2026-04-01T00:00:01.000Z'),
      retryCount: 0,
    });
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:old-visit-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '古い入力' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(dbMocks.deleteVisitDrafts).not.toHaveBeenCalled();
  });

  it('does not count stale successful responses as synced when the queue row changed', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.toArray.mockResolvedValue([
      {
        id: 24,
        entityType: 'visit_record',
        payload: 'encv1:old-visit-payload',
        scope_id: 'schedule-1',
        createdAt,
        retryCount: 0,
      },
    ]);
    dbMocks.get.mockResolvedValue({
      id: 24,
      entityType: 'visit_record',
      payload: 'encv1:old-visit-payload',
      scope_id: 'schedule-1',
      createdAt,
      retryCount: 3,
      lastError: 'HTTP 409 conflict',
      conflict_state: 'server_conflict',
      conflict_payload: 'encv1:conflict-payload',
    });
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:old-visit-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '古い入力' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(dbMocks.deleteVisitDrafts).not.toHaveBeenCalled();
  });

  it('does not double-count a successful response when the queue row was already removed', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.toArray.mockResolvedValue([
      {
        id: 25,
        entityType: 'residual_medication',
        payload: 'encv1:residual-payload',
        scope_id: 'patient-1',
        createdAt,
        retryCount: 0,
      },
    ]);
    dbMocks.get.mockResolvedValue(null);
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:residual-payload') {
          return JSON.stringify({ patient_id: 'patient-1', note: '残薬あり' });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 0,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
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

  it('preserves residual medication DrugMaster IDs in server conflict snapshots', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 15,
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
              id: 'visit-record-1',
              version: 2,
              patient_id: 'patient-1',
              visit_date: '2026-04-01',
              outcome_status: 'completed',
              soap_subjective: null,
              soap_objective: null,
              soap_assessment: null,
              soap_plan: null,
              next_visit_suggestion_date: null,
              residual_medications: [
                {
                  drug_master_id: 'drug_master_amlodipine',
                  drug_name: 'アムロジピン錠5mg',
                  drug_code: null,
                  prescribed_quantity: null,
                  prescribed_daily_dose: null,
                  remaining_quantity: 8,
                  is_prohibited_reduction: false,
                },
              ],
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
    expect(JSON.parse(conflictEncryptCall![0] as string)).toMatchObject({
      server: {
        residual_medications: [
          {
            drug_master_id: 'drug_master_amlodipine',
            drug_name: 'アムロジピン錠5mg',
          },
        ],
      },
    });
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

  it('does not report conflict overwrite success when the queue row changed before cleanup', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.get
      .mockResolvedValueOnce({
        id: 14,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        conflict_payload: 'encv1:valid-conflict-payload',
        scope_id: 'schedule-1',
        createdAt,
        retryCount: 3,
        lastError: 'HTTP 409 conflict',
        conflict_state: 'server_conflict',
      })
      .mockResolvedValueOnce({
        id: 14,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        conflict_payload: 'encv1:new-conflict-payload',
        scope_id: 'schedule-1',
        createdAt,
        retryCount: 3,
        lastError: 'HTTP 409 conflict',
        conflict_state: 'server_conflict',
      });
    cryptoMocks.decryptOfflinePayload.mockImplementation(
      async (value: string | null | undefined) => {
        if (value === 'encv1:valid-sync-payload') {
          return JSON.stringify({ schedule_id: 'schedule-1', soap_subjective: '眠気あり' });
        }
        if (value === 'encv1:valid-conflict-payload') {
          return JSON.stringify({
            local: { schedule_id: 'schedule-1', soap_subjective: '眠気あり' },
            server: {
              id: 'visit-record-1',
              version: 2,
              patient_id: 'patient-1',
              visit_date: '2026-04-01',
              outcome_status: 'draft',
              soap_subjective: null,
              soap_objective: null,
              soap_assessment: null,
              soap_plan: null,
              next_visit_suggestion_date: null,
            },
          });
        }
        return value ?? null;
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(
      overwriteVisitRecordConflict({ orgId: 'org-1', endpoints: {} }, 14),
    ).resolves.toEqual({
      ok: false,
      message: '同期対象が更新されています。最新の状態を確認してから再実行してください',
    });

    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(dbMocks.deleteVisitDrafts).not.toHaveBeenCalled();
  });
});
