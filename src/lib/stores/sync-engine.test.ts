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
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
  });

  it('replaces existing non-conflict scoped queue rows with the latest encrypted payload', async () => {
    let inTransaction = false;
    dbMocks.transaction.mockImplementationOnce(async (...args: unknown[]) => {
      expect(args[0]).toBe('rw');
      expect(args).toHaveLength(3);
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw new Error('Missing transaction callback');
      inTransaction = true;
      try {
        return await callback();
      } finally {
        inTransaction = false;
      }
    });
    dbMocks.update.mockImplementationOnce(async () => {
      expect(inTransaction).toBe(true);
      return 1;
    });
    dbMocks.delete.mockImplementationOnce(async () => {
      expect(inTransaction).toBe(true);
      return undefined;
    });
    dbMocks.and.mockImplementationOnce((predicate: (item: unknown) => boolean) => ({
      toArray: async () =>
        [
          {
            id: 31,
            entityType: 'visit_record',
            payload: 'encv1:oldest',
            scope_id: 'schedule-1',
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            retryCount: 2,
            lastError: 'HTTP 500',
          },
          {
            id: 32,
            entityType: 'visit_record',
            payload: 'encv1:newer',
            scope_id: 'schedule-1',
            createdAt: new Date('2026-04-01T00:01:00.000Z'),
            retryCount: 3,
            lastError: 'HTTP 500',
          },
          {
            id: 33,
            entityType: 'residual_medication',
            payload: 'encv1:different-entity',
            scope_id: 'schedule-1',
            createdAt: new Date('2026-04-01T00:02:00.000Z'),
            retryCount: 3,
            lastError: 'HTTP 500',
          },
        ].filter(predicate),
    }));

    await enqueueForSync('visit_record', {
      schedule_id: 'schedule-1',
      soap_subjective: '新しい入力',
    });

    expect(dbMocks.where).toHaveBeenCalledWith('scope_id');
    expect(dbMocks.equals).toHaveBeenCalledWith('schedule-1');
    expect(dbMocks.transaction).toHaveBeenCalledTimes(1);
    expect(dbMocks.add).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        entityType: 'visit_record',
        payload: 'encv1:sync queue visit_record payload:sealed',
        scope_id: 'schedule-1',
        retryCount: 0,
        lastError: undefined,
        conflict_state: undefined,
        conflict_payload: undefined,
      }),
    );
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
    expect(dbMocks.delete).toHaveBeenCalledWith(31);
    const payloadCall = cryptoMocks.encryptOfflinePayloadRequired.mock.calls.find(
      ([, context]) => context === 'sync queue visit_record payload',
    );
    expect(payloadCall).toBeDefined();
    expect(JSON.parse(payloadCall![0] as string)).toMatchObject({
      schedule_id: 'schedule-1',
      soap_subjective: '新しい入力',
    });
  });

  it('uses id as the deterministic newest tie-breaker for same-timestamp visit drafts', async () => {
    const sameCreatedAt = new Date('2026-04-01T00:00:00.000Z');
    dbMocks.and.mockImplementationOnce((predicate: (item: unknown) => boolean) => ({
      toArray: async () =>
        [
          {
            id: 31,
            entityType: 'visit_record',
            payload: 'encv1:older-id',
            scope_id: 'schedule-1',
            createdAt: sameCreatedAt,
            retryCount: 1,
          },
          {
            id: 32,
            entityType: 'visit_record',
            payload: 'encv1:newer-id',
            scope_id: 'schedule-1',
            createdAt: sameCreatedAt,
            retryCount: 2,
          },
        ].filter(predicate),
    }));

    await enqueueForSync('visit_record', {
      schedule_id: 'schedule-1',
      soap_subjective: '同一ミリ秒の最新入力',
    });

    expect(dbMocks.update).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        entityType: 'visit_record',
        scope_id: 'schedule-1',
        retryCount: 0,
        lastError: undefined,
      }),
    );
    expect(dbMocks.delete).toHaveBeenCalledWith(31);
  });

  it('preserves scoped server conflict rows and adds a fresh pending row beside them', async () => {
    dbMocks.and.mockImplementationOnce((predicate: (item: unknown) => boolean) => ({
      toArray: async () =>
        [
          {
            id: 41,
            entityType: 'visit_record',
            payload: 'encv1:conflict-local',
            conflict_payload: 'encv1:conflict-snapshot',
            scope_id: 'schedule-1',
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            retryCount: 3,
            lastError: 'HTTP 409 conflict',
            conflict_state: 'server_conflict',
          },
        ].filter(predicate),
    }));

    await enqueueForSync('visit_record', {
      schedule_id: 'schedule-1',
      soap_subjective: '競合とは別の新しい下書き',
    });

    expect(dbMocks.update).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'visit_record',
        payload: 'encv1:sync queue visit_record payload:sealed',
        scope_id: 'schedule-1',
        retryCount: 0,
      }),
    );
  });

  it('keeps residual medication enqueue append-only even when patient_id is present', async () => {
    await enqueueForSync('residual_medication', {
      patient_id: 'patient-1',
      drug_name: '薬A',
      remaining_quantity: 10,
    });
    await enqueueForSync('residual_medication', {
      patient_id: 'patient-1',
      drug_name: '薬B',
      remaining_quantity: 3,
    });

    expect(dbMocks.where).not.toHaveBeenCalledWith('scope_id');
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(dbMocks.add).toHaveBeenCalledTimes(2);
    expect(dbMocks.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        entityType: 'residual_medication',
        scope_id: 'patient-1',
        payload: 'encv1:sync queue residual_medication payload:sealed',
      }),
    );
    expect(dbMocks.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        entityType: 'residual_medication',
        scope_id: 'patient-1',
        payload: 'encv1:sync queue residual_medication payload:sealed',
      }),
    );
  });

  it('keeps append-only behavior when a sync payload has no stable scope id', async () => {
    await enqueueForSync('residual_medication', {
      note: 'scope の無い残薬メモ',
    });

    expect(dbMocks.where).not.toHaveBeenCalledWith('scope_id');
    expect(dbMocks.transaction).not.toHaveBeenCalled();
    expect(dbMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'residual_medication',
        scope_id: undefined,
      }),
    );
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
      nextAttemptAt: expect.any(Date),
      lastError: 'Invalid sync payload',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
  });

  it('does not consume retries while the browser is offline', async () => {
    vi.stubGlobal('window', { navigator: { onLine: false } });

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 0,
    });

    expect(dbMocks.where).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('skips failed queue rows until their next attempt time is due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    dbMocks.toArray.mockResolvedValue([
      {
        id: 19,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 1,
        nextAttemptAt: new Date('2026-04-01T00:00:30.000Z'),
        lastError: 'HTTP 503',
      },
    ]);

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 0,
    });

    expect(cryptoMocks.decryptOfflinePayload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
  });

  it('processes failed queue rows once nextAttemptAt is due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:31.000Z'));
    dbMocks.toArray.mockResolvedValue([
      {
        id: 20,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 1,
        nextAttemptAt: new Date('2026-04-01T00:00:30.000Z'),
        lastError: 'HTTP 503',
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
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { id: 'record-1' } })));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 1,
      failed: 0,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(dbMocks.delete).toHaveBeenCalledWith(20);
  });

  it('stores deterministic backoff metadata after a retryable HTTP failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    dbMocks.toArray.mockResolvedValue([
      {
        id: 27,
        entityType: 'visit_record',
        payload: 'encv1:valid-sync-payload',
        scope_id: 'schedule-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 1,
        lastError: 'HTTP 502',
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
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(dbMocks.update).toHaveBeenCalledWith(27, {
      retryCount: 2,
      nextAttemptAt: new Date('2026-04-01T00:02:00.000Z'),
      lastError: 'HTTP 503',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
  });

  it('rejects legacy plaintext sync payloads without sending PHI to the server', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 14,
        entityType: 'visit_record',
        payload: JSON.stringify({
          schedule_id: 'schedule-plain',
          soap_subjective: '患者名 山田太郎 眠気あり',
        }),
        scope_id: 'schedule-plain',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        retryCount: 0,
      },
    ]);
    cryptoMocks.decryptOfflinePayload.mockResolvedValue(null);

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith(14, {
      payload: 'encv1:sync queue legacy plaintext tombstone:sealed',
      retryCount: 3,
      nextAttemptAt: undefined,
      lastError: 'Legacy plaintext sync payload discarded',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
    expect(JSON.stringify(dbMocks.update.mock.calls)).not.toContain('山田太郎');
    const tombstoneCall = cryptoMocks.encryptOfflinePayloadRequired.mock.calls.find(
      ([, context]) => context === 'sync queue legacy plaintext tombstone',
    );
    expect(tombstoneCall).toBeDefined();
    expect(tombstoneCall?.[0]).not.toContain('山田太郎');
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
      nextAttemptAt: expect.any(Date),
      lastError: 'Invalid sync payload',
      conflict_state: undefined,
      conflict_payload: undefined,
    });
  });

  it('stores a generic lastError instead of raw unexpected sync error text', async () => {
    dbMocks.toArray.mockResolvedValue([
      {
        id: 18,
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
    vi.mocked(fetch).mockRejectedValue(
      new Error('network failed patient=患者A db_password=value token=secret'),
    );

    await expect(processSyncQueue({ orgId: 'org-1', endpoints: {} })).resolves.toEqual({
      synced: 0,
      failed: 1,
    });

    expect(dbMocks.update).toHaveBeenCalledWith(18, {
      retryCount: 1,
      nextAttemptAt: expect.any(Date),
      lastError: '同期に失敗しました',
    });
    const persisted = JSON.stringify(dbMocks.update.mock.calls);
    expect(persisted).not.toContain('patient=患者A');
    expect(persisted).not.toContain('db_password=value');
    expect(persisted).not.toContain('token=secret');
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

  it('logs a safe automatic sync failure message without raw error text', async () => {
    const addEventListenerMock = vi.fn();
    const removeEventListenerMock = vi.fn();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', {
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    });
    dbMocks.where.mockImplementation(() => {
      throw new Error('sync db failed patient=患者A db_password=value token=secret');
    });

    const unsubscribe = setupAutoSync({ orgId: 'org-safe-log', endpoints: {} });
    const handler = addEventListenerMock.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();
    handler?.();

    await waitForAsyncAssertion(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        '[offline-sync] automatic sync failed',
        '同期に失敗しました',
      );
    });
    const logged = JSON.stringify(consoleWarn.mock.calls);
    expect(logged).not.toContain('patient=患者A');
    expect(logged).not.toContain('db_password=value');
    expect(logged).not.toContain('token=secret');

    unsubscribe();
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
      failed: 0,
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
      failed: 0,
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
