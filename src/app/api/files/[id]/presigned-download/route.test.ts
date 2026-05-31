import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, createPresignedDownloadMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  createPresignedDownloadMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  FileStorageError: class FileStorageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  createPresignedDownload: createPresignedDownloadMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/files/file_1/presigned-download') {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/files/[id]/presigned-download GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    createPresignedDownloadMock.mockResolvedValue({
      id: 'file_1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      purpose: 'report',
      downloadUrl: 'https://example.com/download',
      expiresIn: 900,
    });
  });

  it('returns a presigned download url for the requested file', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createPresignedDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        downloadUrl: 'https://example.com/download',
      },
    });
  });

  it('redirects to the presigned url when download=1 is specified', async () => {
    const response = await GET(
      createRequest('http://localhost/api/files/file_1/presigned-download?download=1'),
      {
        params: Promise.resolve({ id: 'file_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/download');
  });
});
