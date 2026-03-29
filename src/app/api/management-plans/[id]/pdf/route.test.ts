import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildManagementPlanPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildManagementPlanPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
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

import { GET } from './route';

describe('/api/management-plans/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
      },
    });
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
  });

  it('returns the rendered management plan pdf', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'plan.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'plan.pdf');
  });

  it('returns 404 when the pdf source is missing', async () => {
    buildManagementPlanPdfMock.mockRejectedValue(new Error('管理計画書が見つかりません'));

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(404);
  });
});
