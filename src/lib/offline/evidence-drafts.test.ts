import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { evidenceDraftsMock, decryptOfflinePayloadMock } = vi.hoisted(() => ({
  evidenceDraftsMock: {
    add: vi.fn(),
    and: vi.fn(),
    aboveOrEqual: vi.fn(),
    below: vi.fn(),
    equals: vi.fn(),
    toArray: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    where: vi.fn(),
  },
  decryptOfflinePayloadMock: vi.fn(),
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    evidenceDrafts: evidenceDraftsMock,
  },
}));

vi.mock('@/lib/offline/crypto', () => ({
  decryptOfflinePayload: decryptOfflinePayloadMock,
  encryptOfflinePayloadRequired: vi.fn(),
}));

import {
  listEvidenceDraftSummaries,
  listEvidenceDraftSummariesForSchedule,
  setupEvidenceAutoSync,
  syncEvidenceDrafts,
} from './evidence-drafts';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    scheduleId: 'schedule_1',
    patientId: 'patient_1',
    category: 'photo',
    fileName: 'evidence.png',
    mimeType: 'image/png',
    sizeBytes: 12,
    payload: 'encrypted-data-url',
    capturedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    synced: false,
    retryCount: 0,
    ...overrides,
  };
}

describe('offline evidence draft sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    evidenceDraftsMock.add.mockReset();
    evidenceDraftsMock.and.mockReset();
    evidenceDraftsMock.aboveOrEqual.mockReset();
    evidenceDraftsMock.below.mockReset();
    evidenceDraftsMock.equals.mockReset();
    evidenceDraftsMock.toArray.mockReset();
    evidenceDraftsMock.update.mockReset();
    evidenceDraftsMock.delete.mockReset();
    evidenceDraftsMock.where.mockReset();
    evidenceDraftsMock.and.mockReturnValue({ toArray: evidenceDraftsMock.toArray });
    evidenceDraftsMock.aboveOrEqual.mockReturnValue({ and: evidenceDraftsMock.and });
    evidenceDraftsMock.below.mockReturnValue({ and: evidenceDraftsMock.and });
    evidenceDraftsMock.equals.mockReturnValue({ and: evidenceDraftsMock.and });
    evidenceDraftsMock.where.mockImplementation((index: string) => {
      if (index === 'retryCount') {
        return {
          aboveOrEqual: evidenceDraftsMock.aboveOrEqual,
          below: evidenceDraftsMock.below,
        };
      }
      if (index === 'scheduleId') {
        return {
          equals: evidenceDraftsMock.equals,
        };
      }
      throw new Error(`unexpected evidenceDrafts index ${index}`);
    });
    decryptOfflinePayloadMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('lists unsynced draft summaries through the synced index without decrypting payloads', async () => {
    evidenceDraftsMock.toArray.mockResolvedValue([
      createDraft({ id: 1, scheduleId: 'schedule_1', fileName: 'a.png' }),
    ]);

    await expect(listEvidenceDraftSummaries()).resolves.toEqual([
      {
        id: 1,
        scheduleId: 'schedule_1',
        category: 'photo',
        fileName: 'a.png',
        capturedAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    expect(evidenceDraftsMock.where).toHaveBeenCalledWith('retryCount');
    expect(evidenceDraftsMock.aboveOrEqual).toHaveBeenCalledWith(0);
    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
  });

  it('keeps synced drafts out of summary results after the retryCount index scan', async () => {
    const indexedRows = [
      createDraft({ id: 1, scheduleId: 'schedule_1', fileName: 'pending.png', synced: false }),
      createDraft({ id: 2, scheduleId: 'schedule_2', fileName: 'synced.png', synced: true }),
    ];
    evidenceDraftsMock.and.mockImplementationOnce((predicate: (draft: unknown) => boolean) => ({
      toArray: async () => indexedRows.filter(predicate),
    }));

    await expect(listEvidenceDraftSummaries()).resolves.toEqual([
      {
        id: 1,
        scheduleId: 'schedule_1',
        category: 'photo',
        fileName: 'pending.png',
        capturedAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
  });

  it('lists draft summaries for one schedule without decrypting payloads', async () => {
    const indexedRows = [
      createDraft({
        id: 1,
        scheduleId: 'schedule_1',
        fileName: 'pending.png',
        retryCount: 0,
        synced: false,
      }),
      createDraft({
        id: 2,
        scheduleId: 'schedule_1',
        fileName: 'synced.png',
        retryCount: 0,
        synced: true,
      }),
      createDraft({
        id: 3,
        scheduleId: 'schedule_1',
        fileName: 'legacy-bad-retry.png',
        retryCount: -1,
        synced: false,
      }),
    ];
    evidenceDraftsMock.and.mockImplementationOnce((predicate: (draft: unknown) => boolean) => ({
      toArray: async () => indexedRows.filter(predicate),
    }));

    await expect(listEvidenceDraftSummariesForSchedule('schedule_1')).resolves.toEqual([
      {
        id: 1,
        scheduleId: 'schedule_1',
        category: 'photo',
        fileName: 'pending.png',
        capturedAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    expect(evidenceDraftsMock.where).toHaveBeenCalledWith('scheduleId');
    expect(evidenceDraftsMock.equals).toHaveBeenCalledWith('schedule_1');
    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
  });

  it('does not process retry-exhausted drafts returned by a defensive DB query', async () => {
    const indexedRows = [
      createDraft({ id: 1, scheduleId: 'schedule_1', retryCount: 2, synced: false }),
      createDraft({ id: 2, scheduleId: 'schedule_2', retryCount: 3, synced: false }),
      createDraft({ id: 3, scheduleId: 'schedule_3', retryCount: 0, synced: true }),
    ];
    evidenceDraftsMock.and.mockImplementationOnce((predicate: (draft: unknown) => boolean) => ({
      toArray: async () => indexedRows.filter(predicate),
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/visit-schedules/schedule_1') {
        return jsonResponse({ visit_record: null });
      }
      if (url === '/api/visit-records/schedule_1') {
        return jsonResponse({ message: 'not found' }, 404);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 0,
      skipped: 1,
      failed: 0,
    });

    expect(evidenceDraftsMock.below).toHaveBeenCalledWith(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.update).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
  });

  it('resumes attachment without re-uploading when a completed file asset is stored', async () => {
    evidenceDraftsMock.toArray.mockResolvedValue([
      createDraft({
        uploadedFileAssetId: 'file_existing',
        uploadedVisitRecordId: 'visit_record_1',
      }),
    ]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/visit-schedules/schedule_1') {
        return jsonResponse({ visit_record: { id: 'visit_record_1' } });
      }
      if (url === '/api/visit-records/visit_record_1' && !init?.method) {
        return jsonResponse({ version: 3, attachments: [{ file_id: 'file_old' }] });
      }
      if (url === '/api/visit-records/visit_record_1' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          version: 3,
          attachments: [{ file_id: 'file_old' }, { file_id: 'file_existing' }],
        });
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 1,
      skipped: 0,
      failed: 0,
    });

    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/files/presigned-upload', expect.anything());
    expect(evidenceDraftsMock.update).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).toHaveBeenCalledWith(1);
  });

  it('encodes hostile schedule and visit-record IDs only when constructing sync URL paths', async () => {
    const hostileScheduleId = 'schedule/../tenant?date=2026-06-22#frag';
    const hostileVisitRecordId = 'visit-record/../tenant?record=1#frag';
    const encodedScheduleId = encodeURIComponent(hostileScheduleId);
    const encodedVisitRecordId = encodeURIComponent(hostileVisitRecordId);
    const expectedScheduleUrl = `/api/visit-schedules/${encodedScheduleId}`;
    const expectedVisitRecordUrl = `/api/visit-records/${encodedVisitRecordId}`;
    const presignedBodies: Record<string, unknown>[] = [];
    evidenceDraftsMock.toArray.mockResolvedValue([createDraft({ scheduleId: hostileScheduleId })]);
    decryptOfflinePayloadMock.mockResolvedValue('data:image/png;base64,AAAA');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === expectedScheduleUrl) {
        return jsonResponse({ visit_record: { id: hostileVisitRecordId } });
      }
      if (url === 'data:image/png;base64,AAAA') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url === '/api/files/presigned-upload') {
        presignedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({
          data: {
            id: 'file_new',
            uploadUrl: 'https://upload.example/file_new',
            headers: { 'x-upload': '1' },
          },
        });
      }
      if (url === 'https://upload.example/file_new' && init?.method === 'PUT') {
        return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
      }
      if (url === '/api/files/complete') {
        return jsonResponse({ data: { id: 'file_new' } });
      }
      if (url === expectedVisitRecordUrl && !init?.method) {
        return jsonResponse({ version: 2, attachments: [] });
      }
      if (url === expectedVisitRecordUrl && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          version: 2,
          attachments: [{ file_id: 'file_new' }],
        });
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 1,
      skipped: 0,
      failed: 0,
    });

    const fetchedUrls = fetchMock.mock.calls.map(([input, init]) => ({
      method: init?.method ?? 'GET',
      url: String(input),
    }));
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        { method: 'GET', url: expectedScheduleUrl },
        { method: 'GET', url: expectedVisitRecordUrl },
        { method: 'PATCH', url: expectedVisitRecordUrl },
      ]),
    );
    expect(fetchedUrls.map(({ url }) => url)).not.toContain(
      `/api/visit-schedules/${hostileScheduleId}`,
    );
    expect(fetchedUrls.map(({ url }) => url)).not.toContain(
      `/api/visit-records/${hostileVisitRecordId}`,
    );
    expect(presignedBodies).toHaveLength(1);
    const [presignedBody] = presignedBodies;
    expect(presignedBody).toMatchObject({
      purpose: 'visit-photo',
      visit_record_id: hostileVisitRecordId,
    });
    expect(presignedBody.visit_record_id).not.toBe(encodedVisitRecordId);
    expect(evidenceDraftsMock.update).toHaveBeenCalledWith(1, {
      uploadedFileAssetId: 'file_new',
      uploadedVisitRecordId: hostileVisitRecordId,
      lastError: undefined,
    });
    expect(evidenceDraftsMock.delete).toHaveBeenCalledWith(1);
  });

  it('encodes hostile schedule ID for visit-record fallback while preserving raw record identity', async () => {
    const hostileScheduleId = 'schedule/../fallback?date=2026-06-22#frag';
    const encodedScheduleId = encodeURIComponent(hostileScheduleId);
    const expectedScheduleUrl = `/api/visit-schedules/${encodedScheduleId}`;
    const expectedFallbackRecordUrl = `/api/visit-records/${encodedScheduleId}`;
    evidenceDraftsMock.toArray.mockResolvedValue([
      createDraft({
        scheduleId: hostileScheduleId,
        uploadedFileAssetId: 'file_existing',
        uploadedVisitRecordId: hostileScheduleId,
      }),
    ]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === expectedScheduleUrl) {
        return jsonResponse({ message: 'not found' }, 404);
      }
      if (url === expectedFallbackRecordUrl && !init?.method) {
        if (fetchMock.mock.calls.length === 2) return jsonResponse({ ok: true });
        return jsonResponse({ version: 4, attachments: [{ file_id: 'file_old' }] });
      }
      if (url === expectedFallbackRecordUrl && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          version: 4,
          attachments: [{ file_id: 'file_old' }, { file_id: 'file_existing' }],
        });
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 1,
      skipped: 0,
      failed: 0,
    });

    const fetchedUrls = fetchMock.mock.calls.map(([input, init]) => ({
      method: init?.method ?? 'GET',
      url: String(input),
    }));
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        { method: 'GET', url: expectedScheduleUrl },
        { method: 'GET', url: expectedFallbackRecordUrl },
        { method: 'PATCH', url: expectedFallbackRecordUrl },
      ]),
    );
    expect(fetchedUrls.map(({ url }) => url)).not.toContain(
      `/api/visit-schedules/${hostileScheduleId}`,
    );
    expect(fetchedUrls.map(({ url }) => url)).not.toContain(
      `/api/visit-records/${hostileScheduleId}`,
    );
    expect(decryptOfflinePayloadMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/files/presigned-upload', expect.anything());
    expect(evidenceDraftsMock.update).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).toHaveBeenCalledWith(1);
  });

  it('persists completed file metadata before retrying a failed attachment patch', async () => {
    evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
    decryptOfflinePayloadMock.mockResolvedValue('data:image/png;base64,AAAA');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/visit-schedules/schedule_1') {
        return jsonResponse({ visit_record: { id: 'visit_record_1' } });
      }
      if (url === 'data:image/png;base64,AAAA') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url === '/api/files/presigned-upload') {
        return jsonResponse({
          data: {
            id: 'file_new',
            uploadUrl: 'https://upload.example/file_new',
            headers: { 'x-upload': '1' },
          },
        });
      }
      if (url === 'https://upload.example/file_new' && init?.method === 'PUT') {
        return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
      }
      if (url === '/api/files/complete') {
        return jsonResponse({ data: { id: 'file_new' } });
      }
      if (url === '/api/visit-records/visit_record_1' && !init?.method) {
        return jsonResponse({ version: 2, attachments: [] });
      }
      if (url === '/api/visit-records/visit_record_1' && init?.method === 'PATCH') {
        return jsonResponse(
          { message: 'version conflict: 患者名=山田 token=secret-presign-token' },
          409,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 0,
      skipped: 0,
      failed: 1,
    });

    expect(evidenceDraftsMock.update).toHaveBeenNthCalledWith(1, 1, {
      uploadedFileAssetId: 'file_new',
      uploadedVisitRecordId: 'visit_record_1',
      lastError: undefined,
    });
    expect(evidenceDraftsMock.update).toHaveBeenNthCalledWith(2, 1, {
      retryCount: 1,
      lastError: '訪問記録への添付紐づけに失敗しました',
    });
    expect(JSON.stringify(evidenceDraftsMock.update.mock.calls)).not.toContain('山田');
    expect(JSON.stringify(evidenceDraftsMock.update.mock.calls)).not.toContain(
      'secret-presign-token',
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
  });

  it('stores a generic lastError instead of raw unexpected error text', async () => {
    evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
    decryptOfflinePayloadMock.mockResolvedValue('data:image/png;base64,AAAA');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/visit-schedules/schedule_1') {
        return jsonResponse({ visit_record: { id: 'visit_record_1' } });
      }
      if (url === 'data:image/png;base64,AAAA') {
        throw new Error('upload failed for 患者名=山田 token=secret-upload-token');
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
      synced: 0,
      skipped: 0,
      failed: 1,
    });

    expect(evidenceDraftsMock.update).toHaveBeenCalledWith(1, {
      retryCount: 1,
      lastError: '証跡写真の同期に失敗しました',
    });
    expect(JSON.stringify(evidenceDraftsMock.update.mock.calls)).not.toContain('山田');
    expect(JSON.stringify(evidenceDraftsMock.update.mock.calls)).not.toContain(
      'secret-upload-token',
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['decrypt failure', 'decrypt', '写真データを復号できませんでした'],
    ['PUT upload failure', 'put', '写真のアップロードに失敗しました'],
    ['complete failure', 'complete', '写真のアップロード確定に失敗しました'],
    ['visit-record detail failure', 'detail', '訪問記録の取得に失敗しました'],
  ])(
    'keeps the safe static lastError for %s without leaking server text',
    async (_, failAt, expectedLastError) => {
      evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
      decryptOfflinePayloadMock.mockResolvedValue(
        failAt === 'decrypt' ? null : 'data:image/png;base64,AAAA',
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/visit-schedules/schedule_1') {
          return jsonResponse({ visit_record: { id: 'visit_record_1' } });
        }
        if (url === 'data:image/png;base64,AAAA') {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        if (url === '/api/files/presigned-upload') {
          return jsonResponse({
            data: {
              id: 'file_new',
              uploadUrl: 'https://upload.example/file_new',
              headers: { 'x-upload': '1' },
            },
          });
        }
        if (url === 'https://upload.example/file_new' && init?.method === 'PUT') {
          if (failAt === 'put') {
            return jsonResponse({ message: 'PUT failed 患者名=山田 token=secret-put-token' }, 500);
          }
          return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
        }
        if (url === '/api/files/complete') {
          if (failAt === 'complete') {
            return jsonResponse(
              { message: 'complete failed 患者名=山田 token=secret-complete-token' },
              500,
            );
          }
          return jsonResponse({ data: { id: 'file_new' } });
        }
        if (url === '/api/visit-records/visit_record_1' && !init?.method) {
          if (failAt === 'detail') {
            return jsonResponse(
              { message: 'detail failed 患者名=山田 token=secret-detail-token' },
              500,
            );
          }
          return jsonResponse({ version: 2, attachments: [] });
        }
        if (url === '/api/visit-records/visit_record_1' && init?.method === 'PATCH') {
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
        synced: 0,
        skipped: 0,
        failed: 1,
      });

      expect(evidenceDraftsMock.update).toHaveBeenLastCalledWith(1, {
        retryCount: 1,
        lastError: expectedLastError,
      });
      const persistedCalls = JSON.stringify(evidenceDraftsMock.update.mock.calls);
      expect(persistedCalls).not.toContain('山田');
      expect(persistedCalls).not.toContain('secret-');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('山田');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('secret-');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('山田');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-');
      expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
    },
  );

  it('keeps timeout failures specific without logging raw details', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_EVIDENCE_SYNC_FETCH_TIMEOUT_MS', '1');
    evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('network stalled for 患者名=山田 token=secret-timeout-token'));
          });
        }),
    );

    const sync = syncEvidenceDrafts({ orgId: 'org_1' });
    await vi.advanceTimersByTimeAsync(1);

    await expect(sync).resolves.toEqual({
      synced: 0,
      skipped: 0,
      failed: 1,
    });

    expect(evidenceDraftsMock.update).toHaveBeenCalledWith(1, {
      retryCount: 1,
      lastError: '証跡写真の同期がタイムアウトしました',
    });
    const persistedCalls = JSON.stringify(evidenceDraftsMock.update.mock.calls);
    expect(persistedCalls).not.toContain('山田');
    expect(persistedCalls).not.toContain('secret-timeout-token');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each([
    ['missing id', { data: { uploadUrl: 'https://upload.example/file_new', headers: {} } }],
    ['missing uploadUrl', { data: { id: 'file_malformed', headers: {} } }],
    ['blank id', { data: { id: '   ', uploadUrl: 'https://upload.example/file_new' } }],
    ['blank uploadUrl', { data: { id: 'file_malformed', uploadUrl: '   ' } }],
  ])(
    'fails closed before PUT when the presigned upload response is malformed: %s',
    async (_, body) => {
      evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
      decryptOfflinePayloadMock.mockResolvedValue('data:image/png;base64,AAAA');
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/visit-schedules/schedule_1') {
          return jsonResponse({ visit_record: { id: 'visit_record_1' } });
        }
        if (url === 'data:image/png;base64,AAAA') {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        if (url === '/api/files/presigned-upload') {
          return jsonResponse(body, 201);
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      await expect(syncEvidenceDrafts({ orgId: 'org_1' })).resolves.toEqual({
        synced: 0,
        skipped: 0,
        failed: 1,
      });

      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input) === '/api/files/complete' && init?.method === 'POST',
        ),
      ).toBe(false);
      expect(evidenceDraftsMock.update).toHaveBeenCalledWith(1, {
        retryCount: 1,
        lastError: 'アップロードURLの取得に失敗しました',
      });
      expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
    },
  );

  it('does not log raw automatic sync errors', async () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((event: string, listener: EventListener) => {
      listeners.set(event, listener);
    });
    const removeEventListener = vi.fn();
    vi.stubGlobal('window', {
      navigator: { onLine: true },
      addEventListener,
      removeEventListener,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    evidenceDraftsMock.where.mockImplementationOnce(() => {
      throw new Error('IndexedDB failed for 患者名=山田 token=secret-indexeddb-token');
    });

    const teardown = setupEvidenceAutoSync({ orgId: 'org_1' });
    listeners.get('online')?.(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledWith(
      '[offline-evidence] automatic sync failed',
      '証跡写真の同期に失敗しました',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('山田');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('secret-indexeddb-token');

    teardown();
    expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
  });
});
