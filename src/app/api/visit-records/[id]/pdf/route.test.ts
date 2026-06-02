import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildVisitRecordPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildVisitRecordPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildVisitRecordPdf: buildVisitRecordPdfMock,
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

function createGetRequest() {
  return new NextRequest('http://localhost/api/visit-records/visit_1/pdf');
}

describe('/api/visit-records/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered visit record pdf', async () => {
    buildVisitRecordPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'visit-record.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildVisitRecordPdfMock).toHaveBeenCalledWith('org_1', 'visit_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'visit-record.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ targetType: 'visit_record', format: 'pdf', targetId: 'visit_1' }),
    );
  });

  it('rejects blank visit record ids before rendering or auditing the export', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(buildVisitRecordPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('does not audit or render a pdf when the scoped visit-record lookup fails', async () => {
    buildVisitRecordPdfMock.mockRejectedValue(new Error('訪問記録が見つかりません'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
