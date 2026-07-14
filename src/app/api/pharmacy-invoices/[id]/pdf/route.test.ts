import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHARMACY_INVOICE_PDF_EXPORT_PURPOSE } from '@/lib/audit/export-purpose-codes';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  buildPharmacyInvoiceDocumentPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildPharmacyInvoiceDocumentPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-pharmacy-invoice', () => ({
  buildPharmacyInvoiceDocumentPdf: buildPharmacyInvoiceDocumentPdfMock,
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

function createRequest(purpose = PHARMACY_INVOICE_PDF_EXPORT_PURPOSE) {
  return new NextRequest(
    `http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=${encodeURIComponent(purpose)}`,
  );
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_pharmacy_invoice_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_pharmacy_invoice_pdf_1');
}

describe('/api/pharmacy-invoices/[id]/pdf GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        requestId: 'request_pharmacy_invoice_pdf_1',
        correlationId: 'correlation_pharmacy_invoice_pdf_1',
      },
    });
    buildPharmacyInvoiceDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'pharmacy-invoice.pdf',
      auditMetadata: {
        document_kind: 'invoice',
        billing_month: '2026-06-01',
        status: 'draft',
        item_count: 1,
        subtotal: 5500,
        tax_amount: 550,
        total: 6050,
        patient_display_mode: 'management_number',
        raw_patient_name: '患者 山田太郎 090-1234-5678',
      },
    });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered PDF only after export audit succeeds', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: ' invoice_1 ' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '薬局間請求書 PDF の閲覧権限がありません',
    });
    expect(buildPharmacyInvoiceDocumentPdfMock).toHaveBeenCalledWith('org_1', 'invoice_1');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orgId: 'org_1',
        actorId: 'user_1',
        targetType: 'pharmacy_invoice',
        targetId: 'invoice_1',
        format: 'pdf',
        recordCount: 1,
        requestId: 'request_pharmacy_invoice_pdf_1',
        correlationId: 'correlation_pharmacy_invoice_pdf_1',
        metadata: {
          document_kind: 'invoice',
          billing_month: '2026-06-01',
          status: 'draft',
          item_count: 1,
          subtotal: 5500,
          tax_amount: 550,
          total: 6050,
          export_purpose: PHARMACY_INVOICE_PDF_EXPORT_PURPOSE,
          patient_display_mode: 'management_number',
        },
      }),
    );
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'pharmacy-invoice.pdf');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('患者 山田太郎');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('090-1234-5678');
    expect(PHARMACY_INVOICE_PDF_EXPORT_PURPOSE).toBe('partner_cooperation_monthly_pdf');
  });

  it.each([
    ['legacy UI label', '2026-06-01 薬局間月次出力'],
    ['hostile PHI-like text', '患者 山田太郎 090-1234-5678 の月次請求確認'],
  ])('normalizes valid %s before passing purpose to the audit service', async (_label, input) => {
    const response = await GET(createRequest(input), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(200);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        metadata: expect.objectContaining({
          export_purpose: PHARMACY_INVOICE_PDF_EXPORT_PURPOSE,
        }),
      }),
    );
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain(input);
  });

  it.each(['pharmacy_invoice', 'pharmacy_free_cooperation_report'])(
    'persists only the fixed purpose code and drops PHI siblings for %s',
    async (targetType) => {
      const { buildDataExportAuditChanges } = await vi.importActual<
        typeof import('@/server/services/export-audit')
      >('@/server/services/export-audit');

      const changes = buildDataExportAuditChanges({
        targetType,
        format: 'pdf',
        recordCount: 1,
        metadata: {
          export_purpose: PHARMACY_INVOICE_PDF_EXPORT_PURPOSE,
          patient_name: '患者 山田太郎',
          phone: '090-1234-5678',
        },
      });

      expect(changes).toMatchObject({
        metadata: { export_purpose: PHARMACY_INVOICE_PDF_EXPORT_PURPOSE },
      });
      expect(JSON.stringify(changes)).not.toContain('山田太郎');
      expect(JSON.stringify(changes)).not.toContain('090-1234-5678');
    },
  );

  it.each(['pharmacy_invoice', 'pharmacy_free_cooperation_report'])(
    'does not persist raw free-text purpose metadata for %s',
    async (targetType) => {
      const { buildDataExportAuditChanges } = await vi.importActual<
        typeof import('@/server/services/export-audit')
      >('@/server/services/export-audit');

      const changes = buildDataExportAuditChanges({
        targetType,
        format: 'pdf',
        recordCount: 1,
        metadata: {
          export_purpose: '患者 山田太郎 090-1234-5678 の月次請求確認',
        },
      });

      expect(changes).toMatchObject({ metadata: {} });
      expect(JSON.stringify(changes)).not.toContain('山田太郎');
      expect(JSON.stringify(changes)).not.toContain('090-1234-5678');
    },
  );

  it('rejects missing purpose before rendering or audit side effects', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/pharmacy-invoices/invoice_1/pdf'),
      {
        params: Promise.resolve({ id: 'invoice_1' }),
      },
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildPharmacyInvoiceDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it.each([
    ['blank', '   '],
    ['longer than 200 characters', 'x'.repeat(201)],
  ])('keeps rejecting a %s purpose before side effects', async (_label, purpose) => {
    const response = await GET(createRequest(purpose), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildPharmacyInvoiceDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('fails closed when export audit fails', async () => {
    recordDataExportAuditMock.mockRejectedValue(
      new Error('audit unavailable for 患者 山田太郎 090-1234-5678'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'PHARMACY_INVOICE_PDF_EXPORT_AUDIT_FAILED',
      message: '薬局間請求書 PDF 出力監査を記録できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
  });

  it.each([
    ['not-found', new PdfNotFoundError('pharmacyInvoice')],
    ['conflict', new Error('PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE')],
  ])('does not misclassify %s-shaped audit failures', async (_label, cause) => {
    recordDataExportAuditMock.mockRejectedValue(cause);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHARMACY_INVOICE_PDF_EXPORT_AUDIT_FAILED',
    });
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('maps missing and non-exportable invoices to safe errors', async () => {
    buildPharmacyInvoiceDocumentPdfMock.mockRejectedValueOnce(
      new PdfNotFoundError('pharmacyInvoice'),
    );
    const missingResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });
    expect(missingResponse.status).toBe(404);
    expectSensitiveNoStore(missingResponse);
    expectRequestTrace(missingResponse);
    expect(pdfResponseMock).not.toHaveBeenCalled();

    buildPharmacyInvoiceDocumentPdfMock.mockRejectedValueOnce(
      new Error('PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE'),
    );
    const conflictResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });
    expect(conflictResponse.status).toBe(409);
    expectSensitiveNoStore(conflictResponse);
    expectRequestTrace(conflictResponse);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns a traced fixed render error without exposing the raw cause', async () => {
    buildPharmacyInvoiceDocumentPdfMock.mockRejectedValue(
      new Error('患者 山田花子 090-1234-5678 raw pharmacy invoice render detail'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).not.toContain('山田花子');
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('raw pharmacy invoice render detail');
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns a traced sanitized 500 when response creation fails after the audit', async () => {
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw pharmacy invoice response detail');
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

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
    expect(JSON.stringify(body)).not.toContain('raw pharmacy invoice response detail');
  });

  it('rejects blank invoice ids before rendering or audit side effects', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildPharmacyInvoiceDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });
});
