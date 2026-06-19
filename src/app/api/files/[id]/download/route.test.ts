import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';

const {
  requireAuthContextMock,
  createPresignedDownloadMock,
  recordFileDownloadAuditMock,
  resolveFileDownloadAuditContextMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  createPresignedDownloadMock: vi.fn(),
  recordFileDownloadAuditMock: vi.fn(),
  resolveFileDownloadAuditContextMock: vi.fn(),
  prismaMock: {},
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

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/file-download-audit', () => ({
  recordFileDownloadAudit: recordFileDownloadAuditMock,
  resolveFileDownloadAuditContext: resolveFileDownloadAuditContextMock,
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
    delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        ipAddress: '203.0.113.10',
        userAgent: 'TestBrowser/1.0',
      },
    });
    createPresignedDownloadMock.mockResolvedValue({
      id: 'file_1',
      fileName: '山田花子-report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      purpose: 'report',
      downloadUrl: 'https://example.com/archive.zip',
      expiresIn: 900,
    });
    recordFileDownloadAuditMock.mockResolvedValue(undefined);
    resolveFileDownloadAuditContextMock.mockResolvedValue({
      patientShareConsentId: 'share_consent_1',
      shareCaseId: 'share_case_1',
      hasConsentRecord: true,
      hasValidUntil: false,
      consentRevoked: false,
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
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(createPresignedDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
    expect(recordFileDownloadAuditMock).toHaveBeenCalledWith(prismaMock, {
      orgId: 'org_1',
      actorId: 'user_1',
      fileId: 'file_1',
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 900,
      surface: 'files_download',
      responseMode: 'redirect',
      consentAttachmentContext: {
        patientShareConsentId: 'share_consent_1',
        shareCaseId: 'share_case_1',
        hasConsentRecord: true,
        hasValidUntil: false,
        consentRevoked: false,
      },
      ipAddress: '203.0.113.10',
      userAgent: 'TestBrowser/1.0',
    });
    expect(JSON.stringify(recordFileDownloadAuditMock.mock.calls)).not.toContain(
      'https://example.com/archive.zip',
    );
    expect(JSON.stringify(recordFileDownloadAuditMock.mock.calls)).not.toContain('山田花子');
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
    expect(recordFileDownloadAuditMock).toHaveBeenCalledOnce();
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
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed without returning a redirect when download audit cannot be recorded', async () => {
    recordFileDownloadAuditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'FILE_DOWNLOAD_AUDIT_FAILED',
    });
  });

  it('does not audit when presigned download creation fails', async () => {
    const { FileStorageError } = await import('@/server/services/file-storage');
    createPresignedDownloadMock.mockRejectedValueOnce(
      new FileStorageError('FILE_METADATA_NOT_FOUND', 'ファイルが見つかりません', 404),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(404);
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
  });
});
