import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildBillingDocumentPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildBillingDocumentPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildBillingDocumentPdf: buildBillingDocumentPdfMock,
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

function createRequest(kind = 'receipt') {
  return new NextRequest(
    `http://localhost/api/billing-candidates/candidate_1/documents/pdf?kind=${kind}`,
  );
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/billing-candidates/[id]/documents/pdf GET', () => {
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
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns a rendered receipt pdf and audits the export', async () => {
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'receipt.pdf',
    });

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: ' candidate_1 ' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '請求書類 PDF の閲覧権限がありません',
    });
    expect(buildBillingDocumentPdfMock).toHaveBeenCalledWith('org_1', 'candidate_1', 'receipt');
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'receipt.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'billing_receipt',
        targetId: 'candidate_1',
        format: 'pdf',
      }),
    );
  });

  it('rejects unsupported document kinds before rendering', async () => {
    const response = await GET(createRequest('statement'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'kind は receipt または invoice を指定してください',
    });
    expect(buildBillingDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('maps missing candidates to 404', async () => {
    buildBillingDocumentPdfMock.mockRejectedValue(new Error('請求候補が見つかりません'));

    const response = await GET(createRequest('invoice'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('maps unissued documents to a workflow conflict', async () => {
    buildBillingDocumentPdfMock.mockRejectedValue(new Error('BILLING_DOCUMENT_NOT_ISSUED'));

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '発行済みの領収証または請求書のみPDF出力できます',
    });
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildBillingDocumentPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects blank billing candidate ids before rendering or auditing', async () => {
    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補IDが不正です',
    });
    expect(buildBillingDocumentPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildBillingDocumentPdfMock.mockRejectedValue(
      new Error('candidate_1 raw billing patient render failure'),
    );

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('請求書類 PDF を生成できませんでした');
    expect(body).not.toContain('candidate_1 raw billing patient render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
