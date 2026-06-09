import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';

const { requireAuthContextMock, completeUploadedFileMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  completeUploadedFileMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  completeUploadedFile: completeUploadedFileMock,
  FileStorageError: class FileStorageError extends Error {
    code: string;
    status: number;

    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
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
      status: 'completed',
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
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHOS_LEGACY_FILE_API_DISABLED',
    });
    expect(requireAuthContextMock).not.toHaveBeenCalled();
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
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('rejects non-object completion payloads before updating file state', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON completion bodies before updating file state', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(completeUploadedFileMock).not.toHaveBeenCalled();
  });
});
