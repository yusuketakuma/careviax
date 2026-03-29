import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildPatientVisitRecordsPdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildPatientVisitRecordsPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildPatientVisitRecordsPdf: buildPatientVisitRecordsPdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

import { GET } from './route';

describe('/api/patients/[id]/visit-records/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: { orgId: 'org_1' } });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
  });

  it('passes the date range to patient visit records pdf builder', async () => {
    buildPatientVisitRecordsPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'visit-records.pdf',
    });

    const response = (await GET({
      url: 'http://localhost/api/patients/patient_1/visit-records/pdf?date_from=2026-03-01&date_to=2026-03-31',
    } as NextRequest, {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildPatientVisitRecordsPdfMock).toHaveBeenCalledWith(
      'org_1',
      'patient_1',
      '2026-03-01',
      '2026-03-31',
    );
  });
});
