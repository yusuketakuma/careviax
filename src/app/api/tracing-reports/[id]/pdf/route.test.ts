import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildTracingReportPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildTracingReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildTracingReportPdf: buildTracingReportPdfMock,
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
  return new NextRequest('http://localhost/api/tracing-reports/report_1/pdf');
}

describe('/api/tracing-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('rejects blank tracing report ids before rendering or audit', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'トレーシングレポートIDが不正です',
    });
    expect(buildTracingReportPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns the rendered tracing report pdf', async () => {
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'tracing-report.pdf',
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildTracingReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'tracing-report.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'tracing_report',
        format: 'pdf',
        targetId: 'report_1',
      }),
    );
  });

  it('returns 404 without rendering or audit when the tracing report is not accessible', async () => {
    buildTracingReportPdfMock.mockRejectedValue(new Error('トレーシングレポートが見つかりません'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
