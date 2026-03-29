import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildMedicationCalendarPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildMedicationCalendarPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildMedicationCalendarPdf: buildMedicationCalendarPdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

import { GET } from './route';

describe('/api/patients/[id]/medication-calendar/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('passes month to medication calendar pdf builder', async () => {
    buildMedicationCalendarPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'calendar.pdf',
    });

    const response = (await GET({
      url: 'http://localhost/api/patients/patient_1/medication-calendar/pdf?month=2026-03',
    } as NextRequest, {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildMedicationCalendarPdfMock).toHaveBeenCalledWith(
      'org_1',
      'patient_1',
      '2026-03',
    );
  });
});
