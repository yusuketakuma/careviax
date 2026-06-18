import { beforeEach, describe, expect, it, vi } from 'vitest';

const { evidenceDraftsMock, decryptOfflinePayloadMock } = vi.hoisted(() => ({
  evidenceDraftsMock: {
    add: vi.fn(),
    toArray: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

import { syncEvidenceDrafts } from './evidence-drafts';

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
    evidenceDraftsMock.add.mockReset();
    evidenceDraftsMock.toArray.mockReset();
    evidenceDraftsMock.update.mockReset();
    evidenceDraftsMock.delete.mockReset();
    decryptOfflinePayloadMock.mockReset();
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

  it('persists completed file metadata before retrying a failed attachment patch', async () => {
    evidenceDraftsMock.toArray.mockResolvedValue([createDraft()]);
    decryptOfflinePayloadMock.mockResolvedValue('data:image/png;base64,AAAA');
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
        return jsonResponse({ message: 'version conflict' }, 409);
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
      lastError: 'version conflict',
    });
    expect(evidenceDraftsMock.delete).not.toHaveBeenCalled();
  });
});
