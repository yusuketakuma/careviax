import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildVisitRecordPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildVisitRecordPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
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

import { GET } from './route';

describe('/api/visit-records/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('returns the rendered visit record pdf', async () => {
    buildVisitRecordPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'visit-record.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'visit_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'visit-record.pdf');
  });
});
