import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildCareReportPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildCareReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
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

import { GET } from './route';

describe('/api/care-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('returns the rendered care report pdf', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'care-report.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'care-report.pdf');
  });

  it('returns 404 when the care report does not exist', async () => {
    buildCareReportPdfMock.mockRejectedValue(new Error('報告書が見つかりません'));

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(404);
  });
});
