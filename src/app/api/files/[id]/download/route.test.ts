import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

function createRequest() {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
  } as unknown as NextRequest;
}

describe('/api/files/[id]/download GET', () => {
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
      downloadUrl: 'https://example.com/archive.zip',
    });
  });

  it('redirects to the signed download url', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/archive.zip');
    expect(createPresignedDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      permissions: {
        canVisit: true,
        canReport: true,
      },
    });
  });
});
