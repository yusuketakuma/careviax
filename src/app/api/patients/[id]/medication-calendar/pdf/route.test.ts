import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  buildMedicationCalendarPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildMedicationCalendarPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
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

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { GET } from './route';

function createGetRequest() {
  return new NextRequest(
    'http://localhost/api/patients/patient_1/medication-calendar/pdf?month=2026-03',
  );
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_medication_calendar_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_medication_calendar_pdf_1');
}

describe('/api/patients/[id]/medication-calendar/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        requestId: 'request_medication_calendar_pdf_1',
        correlationId: 'correlation_medication_calendar_pdf_1',
      },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('passes month to medication calendar pdf builder', async () => {
    buildMedicationCalendarPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'calendar.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildMedicationCalendarPdfMock).toHaveBeenCalledWith('org_1', 'patient_1', '2026-03', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'medication_calendar',
        format: 'pdf',
        targetId: 'patient_1',
        requestId: 'request_medication_calendar_pdf_1',
        correlationId: 'correlation_medication_calendar_pdf_1',
      }),
    );
  });

  it('returns a traced sanitized 500 when response creation fails after the audit', async () => {
    buildMedicationCalendarPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'calendar.pdf',
    });
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw medication calendar response detail');
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw medication calendar response detail');
  });

  it('fails closed when the medication calendar PDF export audit cannot be recorded', async () => {
    buildMedicationCalendarPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'calendar.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 provider raw error'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'MEDICATION_CALENDAR_PDF_EXPORT_AUDIT_FAILED',
      message: '服薬カレンダー PDF 出力監査を記録できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田 太郎');
    expect(JSON.stringify(body)).not.toContain('provider raw error');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before building or auditing the pdf', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(buildMedicationCalendarPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or render a pdf when the scoped patient lookup fails', async () => {
    buildMedicationCalendarPdfMock.mockRejectedValue(new PdfNotFoundError('patient'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildMedicationCalendarPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 の服薬カレンダーが見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('服薬カレンダー PDF を生成できませんでした');
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
    expect(buildMedicationCalendarPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildMedicationCalendarPdfMock.mockRejectedValue(
      new Error('patient_1 raw medication calendar render failure'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('服薬カレンダー PDF を生成できませんでした');
    expect(body).not.toContain('patient_1 raw medication calendar render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
