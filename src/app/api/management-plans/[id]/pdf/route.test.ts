import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildManagementPlanPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildManagementPlanPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildManagementPlanPdf: buildManagementPlanPdfMock,
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
  return new NextRequest('http://localhost/api/management-plans/plan_1/pdf');
}

describe('/api/management-plans/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('rejects blank management plan ids before rendering or audit', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '管理計画書IDが不正です',
    });
    expect(buildManagementPlanPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns the rendered management plan pdf', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'plan.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildManagementPlanPdfMock).toHaveBeenCalledWith('org_1', 'plan_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'plan.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ targetType: 'management_plan', format: 'pdf', targetId: 'plan_1' }),
    );
  });

  it('returns 404 when the pdf source is missing', async () => {
    buildManagementPlanPdfMock.mockRejectedValue(new Error('管理計画書が見つかりません'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
