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

function createGetRequest(query = '?date_from=2026-03-01&date_to=2026-03-31') {
  return new NextRequest(`http://localhost/api/patients/patient_1/visit-records/pdf${query}`);
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
        filters: {
          date_from: '2026-03-01',
          date_to: '2026-03-31',
        },
      }),
    );
  });

  it('trims valid date range filters before building and auditing the pdf', async () => {
    buildPatientVisitRecordsPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'visit-records.pdf',
    });

    const response = (await GET(
      createGetRequest('?date_from=%202026-03-01%20&date_to=%202026-03-31%20'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

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
        filters: {
          date_from: '2026-03-01',
          date_to: '2026-03-31',
        },
      }),
    );
  });

  it.each([
    ['?date_from=oops', { date_from: ['日付形式が不正です（YYYY-MM-DD）'] }],
    ['?date_to=2026-02-31', { date_to: ['日付形式が不正です（YYYY-MM-DD）'] }],
    [
      '?date_from=2026-04-01&date_to=2026-03-01',
      { date_to: ['date_to は date_from 以降を指定してください'] },
    ],
  ])(
    'rejects invalid date filters before building or auditing the pdf for %s',
    async (query, details) => {
      const response = (await GET(createGetRequest(query), {
        params: Promise.resolve({ id: 'patient_1' }),
      }))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '検索条件が不正です',
        details,
      });
      expect(buildPatientVisitRecordsPdfMock).not.toHaveBeenCalled();
      expect(pdfResponseMock).not.toHaveBeenCalled();
      expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    },
  );

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
