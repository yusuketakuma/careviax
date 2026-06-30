import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildCareReportPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildCareReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildCareReportPdf: buildCareReportPdfMock,
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

function createRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1/pdf');
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/care-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered care report pdf', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'care-report.pdf',
      reportUpdatedAt: new Date('2026-03-28T09:00:00.000Z'),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(buildCareReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'care-report.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'care_report',
        format: 'pdf',
        targetId: 'report_1',
        metadata: {
          report_updated_at: '2026-03-28T09:00:00.000Z',
        },
      }),
    );
  });

  it('requires report send permission before rendering or auditing the export', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書 PDF の出力権限がありません' }),
        { status: 403 },
      ),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canSendCareReport',
      message: '報告書 PDF の出力権限がありません',
    });
    expect(buildCareReportPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth context fails before rendering', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw care report pdf auth detail'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw care report pdf auth detail');
    expect(buildCareReportPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rejects blank report ids before rendering or auditing the export', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書IDが不正です',
    });
    expect(buildCareReportPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the care report does not exist', async () => {
    buildCareReportPdfMock.mockRejectedValue(new PdfNotFoundError('careReport'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not trust raw not-found-like render error messages', async () => {
    buildCareReportPdfMock.mockRejectedValue(
      new Error('報告書が見つかりません: patient 山田 太郎 token secret_report_pdf'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'EXTERNAL_PDF_RENDER_FAILED',
      message: '報告書 PDF を生成できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田');
    expect(JSON.stringify(body)).not.toContain('secret_report_pdf');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects PDF export for unconfirmed reports without auditing an export', async () => {
    buildCareReportPdfMock.mockRejectedValue(new Error('CARE_REPORT_NOT_CONFIRMED'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '薬剤師確認済みの報告書のみPDF出力できます',
    });
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a generic render failure without exposing malformed PDF details or auditing', async () => {
    buildCareReportPdfMock.mockRejectedValue(
      new Error('Malformed physician_report content leaked patient phone 090-1234-5678'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'EXTERNAL_PDF_RENDER_FAILED',
      message: '報告書 PDF を生成できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('Malformed physician_report content');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed when the PDF export audit cannot be recorded', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'care-report.pdf',
      reportUpdatedAt: new Date('2026-03-28T09:00:00.000Z'),
    });
    recordDataExportAuditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CARE_REPORT_PDF_EXPORT_AUDIT_FAILED',
      message: '報告書 PDF 出力監査を記録できませんでした',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });
});
