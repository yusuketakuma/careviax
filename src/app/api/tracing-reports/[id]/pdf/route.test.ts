import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildTracingReportPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildTracingReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
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

import { GET } from './route';

describe('/api/tracing-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('returns the rendered tracing report pdf', async () => {
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'tracing-report.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'tracing-report.pdf');
  });
});
