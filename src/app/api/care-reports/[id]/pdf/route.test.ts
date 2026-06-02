import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildCareReportPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildCareReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildCareReportPdf: buildCareReportPdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1/pdf');
}

describe('/api/care-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered care report pdf', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'care-report.pdf',
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildCareReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'care-report.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ targetType: 'care_report', format: 'pdf', targetId: 'report_1' }),
    );
  });

  it('rejects blank report ids before rendering or auditing the export', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書IDが不正です',
    });
    expect(buildCareReportPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the care report does not exist', async () => {
    buildCareReportPdfMock.mockRejectedValue(new Error('報告書が見つかりません'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
