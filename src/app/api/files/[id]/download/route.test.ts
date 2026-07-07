import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  prepareFileDownloadMock,
  openPreparedFileDownloadMock,
  recordFileDownloadAuditMock,
  resolveFileDownloadAuditContextMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  prepareFileDownloadMock: vi.fn(),
  openPreparedFileDownloadMock: vi.fn(),
  recordFileDownloadAuditMock: vi.fn(),
  resolveFileDownloadAuditContextMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: {
          orgId: string;
          userId: string;
          role: string;
          actorSiteId?: string;
          ipAddress?: string;
          userAgent?: string;
        },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const authResult = await requireAuthContextMock(req);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
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
  openPreparedFileDownload: openPreparedFileDownloadMock,
  prepareFileDownload: prepareFileDownloadMock,
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

function createBodyStream(value = 'file body') {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
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
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'TestBrowser/1.0',
      },
    });
    prepareFileDownloadMock.mockResolvedValue({
      id: 'file_1',
      fileName: 'report-file-file_1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      purpose: 'report',
      downloadDisposition: 'inline',
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      expiresIn: 0,
    });
    openPreparedFileDownloadMock.mockImplementation(() => Promise.resolve(createBodyStream()));
    recordFileDownloadAuditMock.mockResolvedValue(undefined);
    resolveFileDownloadAuditContextMock.mockResolvedValue({
      patientId: 'patient_1',
      consentAttachmentContext: {
        patientShareConsentId: 'share_consent_1',
        shareCaseId: 'share_case_1',
        hasConsentRecord: true,
        hasValidUntil: false,
        consentRevoked: false,
      },
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
    expect(prepareFileDownloadMock).not.toHaveBeenCalled();
    expect(openPreparedFileDownloadMock).not.toHaveBeenCalled();
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
  });

  it('streams the file body from the same-origin route without returning a signed URL', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Length')).toBe('1024');
    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="report-file-file_1.pdf"',
    );
    expect(response.headers.get('Accept-Ranges')).toBe('none');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expectSensitiveNoStore(response);
    expect(await response.text()).toBe('file body');
    expect(JSON.stringify([...response.headers.entries()])).not.toContain('https://example.com');
    expect(JSON.stringify([...response.headers.entries()])).not.toContain('X-Amz-Signature');
    expect(prepareFileDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
    expect(recordFileDownloadAuditMock.mock.invocationCallOrder[0]).toBeLessThan(
      openPreparedFileDownloadMock.mock.invocationCallOrder[0],
    );
    expect(openPreparedFileDownloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file_1',
        storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      }),
    );
    expect(recordFileDownloadAuditMock).toHaveBeenCalledWith(prismaMock, {
      orgId: 'org_1',
      actorId: 'user_1',
      actorSiteId: 'site_1',
      patientId: 'patient_1',
      fileId: 'file_1',
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 0,
      surface: 'files_download',
      responseMode: 'stream',
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
    const auditPayload = JSON.stringify(recordFileDownloadAuditMock.mock.calls);
    expect(auditPayload).not.toContain('https://example.com/archive.zip');
    expect(auditPayload).not.toContain('downloadUrl');
    expect(auditPayload).not.toContain('response-content-disposition');
    expect(auditPayload).not.toContain('X-Amz-Signature');
    expectPhiExportSnapshotRedacted(auditPayload, ['Taro', 'Yamada']);
  });

  it('normalizes padded file ids before streaming the download', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '  file_1  ' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(200);
    expect(prepareFileDownloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });
    expect(recordFileDownloadAuditMock).toHaveBeenCalledOnce();
  });

  it('rejects blank file ids before streaming', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(prepareFileDownloadMock).not.toHaveBeenCalled();
    expect(openPreparedFileDownloadMock).not.toHaveBeenCalled();
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed without streaming when download audit cannot be recorded', async () => {
    recordFileDownloadAuditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expectSensitiveNoStore(response);
    expect(openPreparedFileDownloadMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'FILE_DOWNLOAD_AUDIT_FAILED',
    });
  });

  it('does not audit when download preparation fails', async () => {
    const { FileStorageError } = await import('@/server/services/file-storage');
    prepareFileDownloadMock.mockRejectedValueOnce(
      new FileStorageError('FILE_METADATA_NOT_FOUND', 'ファイルが見つかりません', 404),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'file_1' }),
    });

    if (!response) {
      throw new Error('Expected a response from file download GET');
    }
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(openPreparedFileDownloadMock).not.toHaveBeenCalled();
    expect(resolveFileDownloadAuditContextMock).not.toHaveBeenCalled();
    expect(recordFileDownloadAuditMock).not.toHaveBeenCalled();
  });
});
