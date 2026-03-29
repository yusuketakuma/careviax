import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildMedicationHistoryPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildMedicationHistoryPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildMedicationHistoryPdf: buildMedicationHistoryPdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

import { GET } from './route';

describe('/api/patients/[id]/medications/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('returns the medication history pdf', async () => {
    buildMedicationHistoryPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'medications.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'medications.pdf');
  });
});
