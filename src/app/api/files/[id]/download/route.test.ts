import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';

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

const originalDisableLegacyFileApi = process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];

function createRequest() {
  return new NextRequest('http://localhost/api/files/file_1/download', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
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

  afterEach(() => {
    if (originalDisableLegacyFileApi === undefined) {
      delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    } else {
      process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = originalDisableLegacyFileApi;
    }
  });

  it('disables the legacy route in PH-OS production before auth or presign', async () => {
    process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = '1';

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHOS_LEGACY_FILE_API_DISABLED',
    });
    expect(requireAuthContextMock).not.toHaveBeenCalled();
    expect(createPresignedDownloadMock).not.toHaveBeenCalled();
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
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
  });

  it('normalizes padded file ids before signing the download redirect', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '  file_1  ' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(307);
    expect(createPresignedDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
  });

  it('rejects blank file ids before signing a download redirect', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(400);
    expect(createPresignedDownloadMock).not.toHaveBeenCalled();
  });
});
