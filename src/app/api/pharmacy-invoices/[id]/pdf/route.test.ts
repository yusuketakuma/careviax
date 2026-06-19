import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function createRequest(purpose = '月次請求確認') {
  return new NextRequest(
    `http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=${encodeURIComponent(purpose)}`,
  );
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
        metadata: expect.objectContaining({
          export_purpose: '月次請求確認',
          patient_display_mode: 'management_number',
          total: 6050,
        }),
      }),
    );
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'pharmacy-invoice.pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  });

  it('rejects missing purpose before rendering or audit side effects', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/pharmacy-invoices/invoice_1/pdf'),
      {
        params: Promise.resolve({ id: 'invoice_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(buildPharmacyInvoiceDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('fails closed when export audit fails', async () => {
    recordDataExportAuditMock.mockRejectedValue(new Error('audit unavailable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });

    expect(response.status).toBe(500);
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_PDF_RENDER_FAILED',
    });
  });

  it('maps missing and non-exportable invoices to safe errors', async () => {
    buildPharmacyInvoiceDocumentPdfMock.mockRejectedValueOnce(
      new PdfNotFoundError('pharmacyInvoice'),
    );
    const missingResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });
    expect(missingResponse.status).toBe(404);
    expect(pdfResponseMock).not.toHaveBeenCalled();

    buildPharmacyInvoiceDocumentPdfMock.mockRejectedValueOnce(
      new Error('PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE'),
    );
    const conflictResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: 'invoice_1' }),
    });
    expect(conflictResponse.status).toBe(409);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });
});
