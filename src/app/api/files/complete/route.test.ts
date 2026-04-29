import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

  it('completes an uploaded file', async () => {
    const response = (await POST({
      json: async () => ({
        file_id: '11111111-1111-4111-8111-111111111111',
        etag: 'etag-1',
      }),
    } as NextRequest))!;

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
});
