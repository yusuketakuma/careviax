import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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

import { PdfNotFoundError } from '@/server/services/pdf-errors';
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
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
      expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(buildPatientVisitRecordsPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or render a pdf when the scoped patient lookup fails', async () => {
    buildPatientVisitRecordsPdfMock.mockRejectedValue(new PdfNotFoundError('patient'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildPatientVisitRecordsPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 の訪問記録が見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('訪問記録一覧 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildPatientVisitRecordsPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildPatientVisitRecordsPdfMock.mockRejectedValue(
      new Error('patient_1 raw visit summary render failure'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('訪問記録一覧 PDF を生成できませんでした');
    expect(body).not.toContain('patient_1 raw visit summary render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
