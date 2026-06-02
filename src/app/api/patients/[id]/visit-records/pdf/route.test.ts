import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildPatientVisitRecordsPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildPatientVisitRecordsPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
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

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createGetRequest() {
  return new NextRequest(
    'http://localhost/api/patients/patient_1/visit-records/pdf?date_from=2026-03-01&date_to=2026-03-31',
  );
}

describe('/api/patients/[id]/visit-records/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('passes the date range to patient visit records pdf builder', async () => {
    buildPatientVisitRecordsPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'visit-records.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(buildPatientVisitRecordsPdfMock).toHaveBeenCalledWith(
      'org_1',
      'patient_1',
      '2026-03-01',
      '2026-03-31',
      {
        userId: 'user_1',
        role: 'pharmacist',
      },
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'visit_record_list',
        format: 'pdf',
        targetId: 'patient_1',
      }),
    );
  });

  it('rejects blank patient ids before building or auditing the pdf', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(buildPatientVisitRecordsPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or render a pdf when the scoped patient lookup fails', async () => {
    buildPatientVisitRecordsPdfMock.mockRejectedValue(new Error('患者が見つかりません'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
