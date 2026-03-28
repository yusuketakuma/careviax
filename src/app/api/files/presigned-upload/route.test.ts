import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  validateOrgReferencesMock,
  careReportFindFirstMock,
  createPresignedUploadMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  createPresignedUploadMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findFirst: careReportFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/file-storage', () => ({
  FileStorageError: class FileStorageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  },
  createPresignedUpload: createPresignedUploadMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/files/presigned-upload POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    validateOrgReferencesMock.mockResolvedValue({
      ok: true,
      data: {},
    });
    careReportFindFirstMock.mockResolvedValue({ id: 'report_1' });
    createPresignedUploadMock.mockResolvedValue({
      id: 'file_1',
      uploadUrl: 'https://example.com/upload',
      objectKey: 'reports/org_1/report_1/file_1-report.pdf',
      expiresIn: 300,
      headers: { 'Content-Type': 'application/pdf' },
    });
  });

  it('returns 400 when required entity ids are missing for the purpose', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns 400 when the referenced report does not exist', async () => {
    careReportFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_missing',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns a presigned upload url when references are valid', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_1',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(createPresignedUploadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: undefined,
      visitRecordId: undefined,
      reportId: 'report_1',
    });
  });
});
