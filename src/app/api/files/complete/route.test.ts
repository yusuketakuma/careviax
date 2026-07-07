import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, completeUploadedFileMock, FileStorageErrorMock } = vi.hoisted(
  () => ({
    requireAuthContextMock: vi.fn(),
    completeUploadedFileMock: vi.fn(),
    FileStorageErrorMock: class FileStorageError extends Error {
      code: string;
      status: number;

      constructor(code: string, message: string, status: number) {
        super(message);
        this.code = code;
        this.status = status;
      }
    },
  }),
);

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
      const authResult = await requireAuthContextMock(req);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
}));

vi.mock('@/server/services/file-storage', () => ({
  completeUploadedFile: completeUploadedFileMock,
  FileStorageError: FileStorageErrorMock,
}));

import { POST } from './route';

const originalDisableLegacyFileApi = process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/files/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/files/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

describe('/api/files/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    completeUploadedFileMock.mockResolvedValue({
      id: 'file_1',
      orgId: 'org_1',
      purpose: 'visit-photo',
      storageKey: 'visit-photos/org_1/visit_1/file_1-photo.png',
      originalName: '患者 山田太郎 処方薬一覧 090-1234-5678.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'uploaded',
      patientId: 'patient_1',
      visitRecordId: 'visit_1',
      reportId: 'report_1',
      uploadedBy: 'user_1',
      etag: 'etag-1',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      completedAt: '2026-07-05T00:00:00.000Z',
    });
  });

  afterEach(() => {
    if (originalDisableLegacyFileApi === undefined) {
      delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    } else {
      process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = originalDisableLegacyFileApi;
    }
  });

  it('disables the legacy route in PH-OS production before auth or file state update', async () => {
    process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = 'true';

    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(410);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHOS_LEGACY_FILE_API_DISABLED',
    });
    expect(requireAuthContextMock).not.toHaveBeenCalled();
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('preserves auth rejection bodies while applying no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_UNAUTHENTICATED',
      message: '認証が必要です',
    });
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('completes an uploaded file', async () => {
    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'file_1',
        status: 'uploaded',
        completedAt: '2026-07-05T00:00:00.000Z',
      },
    });
    expect(completeUploadedFileMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: '11111111-1111-4111-8111-111111111111',
      uploadedBy: 'user_1',
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
      etag: 'etag-1',
    });
  });

  it('normalizes padded file ids and blank etags before completing file state', async () => {
    const response = (await POST(
      createRequest({
        file_id: '  11111111-1111-4111-8111-111111111111  ',
        etag: '   ',
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(completeUploadedFileMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: '11111111-1111-4111-8111-111111111111',
      uploadedBy: 'user_1',
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
      etag: undefined,
    });
  });

  it('rejects blank file ids before updating file state', async () => {
    const response = (await POST(
      createRequest({
        file_id: '   ',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('rejects non-object completion payloads before updating file state', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON completion bodies before updating file state', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('returns no-store storage errors without exposing storage keys', async () => {
    completeUploadedFileMock.mockRejectedValueOnce(
      new FileStorageErrorMock(
        'FILE_NOT_READY',
        'ファイル本体のアップロード完了を確認できませんでした',
        409,
      ),
    );

    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'FILE_NOT_READY',
    });
    expect(JSON.stringify(body)).not.toContain('storageKey');
    expect(JSON.stringify(body)).not.toContain('visit-photos/org_1/visit_1');
  });

  it('returns fixed no-store completion errors without exposing raw provider details', async () => {
    completeUploadedFileMock.mockRejectedValueOnce(
      new Error('S3 failed storageKey=visit-photos/org_1/visit_1/file_1-photo.png patient=患者A'),
    );

    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(502);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'EXTERNAL_FILE_COMPLETE_FAILED',
      message: 'ファイル状態の更新に失敗しました',
    });
    expect(JSON.stringify(body)).not.toContain('storageKey');
    expect(JSON.stringify(body)).not.toContain('visit-photos/org_1/visit_1');
    expect(JSON.stringify(body)).not.toContain('患者A');
  });

  it('does not expose file metadata, storage keys, entity ids, or etags in completed file responses', async () => {
    const response = (await POST(
      createRequest({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(['completedAt', 'id', 'status']);
    expect(JSON.stringify(body)).not.toContain('患者');
    expect(JSON.stringify(body)).not.toContain('山田');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('処方薬一覧');
    expect(JSON.stringify(body)).not.toContain('photo.png');
    expect(JSON.stringify(body)).not.toContain('visit-photo');
    expect(JSON.stringify(body)).not.toContain('image/png');
    expect(JSON.stringify(body)).not.toContain('1024');
    expect(body.data).not.toHaveProperty('purpose');
    expect(body.data).not.toHaveProperty('originalName');
    expect(body.data).not.toHaveProperty('mimeType');
    expect(body.data).not.toHaveProperty('sizeBytes');
    expect(JSON.stringify(body)).not.toContain('storageKey');
    expect(JSON.stringify(body)).not.toContain('visit-photos/org_1/visit_1');
    expect(JSON.stringify(body)).not.toContain('org_1');
    expect(JSON.stringify(body)).not.toContain('patient_1');
    expect(JSON.stringify(body)).not.toContain('visit_1');
    expect(JSON.stringify(body)).not.toContain('report_1');
    expect(JSON.stringify(body)).not.toContain('uploadedBy');
    expect(JSON.stringify(body)).not.toContain('etag-1');
  });
});
