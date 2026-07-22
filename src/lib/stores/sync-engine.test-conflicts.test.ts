import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  add: vi.fn(),
  and: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  below: vi.fn(),
  equals: vi.fn(),
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

import { overwriteVisitRecordConflict, processSyncQueue } from './sync-engine';

describe('sync-engine PHI persistence', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    cryptoMocks.encryptOfflinePayloadRequired.mockImplementation(
      async (_value: string, context: string) => `encv1:${context}:sealed`,
    );
    dbMocks.add.mockResolvedValue(1);
    dbMocks.update.mockResolvedValue(1);
    dbMocks.delete.mockResolvedValue(undefined);
    dbMocks.below.mockReturnValue({ toArray: dbMocks.toArray });
    dbMocks.and.mockReturnValue({ toArray: dbMocks.toArray });
    dbMocks.equals.mockReturnValue({ and: dbMocks.and });
    dbMocks.where.mockImplementation((index: string) => {
      if (index === 'retryCount') return { below: dbMocks.below };
      if (index === 'scope_id') return { equals: dbMocks.equals };
      throw new Error(`Unexpected syncQueue index: ${index}`);
    });
    dbMocks.equalsVisitDrafts.mockReturnValue({ delete: dbMocks.deleteVisitDrafts });
    dbMocks.whereVisitDrafts.mockReturnValue({ equals: dbMocks.equalsVisitDrafts });
    dbMocks.transaction.mockImplementation(async (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw new Error('Missing transaction callback');
      return callback();
    });
    dbMocks.toArray.mockResolvedValue([]);
    dbMocks.get.mockImplementation(async (id: number) => {
      const items = await dbMocks.toArray();
      return Array.isArray(items) ? (items.find((item) => item.id === id) ?? null) : null;
    });
    vi.stubGlobal('fetch', vi.fn());
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
