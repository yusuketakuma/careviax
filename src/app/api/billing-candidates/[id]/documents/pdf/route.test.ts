import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  buildBillingDocumentPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_billing_document_pdf_1',
    correlationId: 'correlation_billing_document_pdf_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  buildBillingDocumentPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: typeof authContext,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      withRoutePerformanceMock(req, async () => {
        let response: Response;
        let trace = authContext;
        try {
          const authResult = await requireAuthContextMock(req, options);
          if ('response' in authResult) {
            response = authResult.response;
          } else {
            trace = authResult.ctx;
            try {
              response = await runWithRequestAuthContextMock(authResult.ctx, () =>
                handler(req, authResult.ctx, routeContext),
              );
            } catch (error) {
              loggerErrorMock(
                {
                  event: 'route_handler_unhandled_error',
                  route: req.nextUrl.pathname,
                  method: req.method,
                  requestId: trace.requestId,
                  correlationId: trace.correlationId,
                },
                error,
              );
              response = NextResponse.json(
                { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
                { status: 500 },
              );
            }
          }
        } catch (error) {
          trace = {
            ...authContext,
            requestId: 'generated_request_billing_pdf_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_billing_pdf_1',
          };
          loggerErrorMock(
            {
              event: 'route_auth_unhandled_error',
              route: req.nextUrl.pathname,
              method: req.method,
              requestId: trace.requestId,
              correlationId: trace.correlationId,
            },
            error,
          );
          response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', trace.requestId);
        response.headers.set('X-Correlation-Id', trace.correlationId);
        return response;
      }),
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

import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { GET } from './route';

function createRequest(kind = 'receipt') {
  return new NextRequest(
    `http://localhost/api/billing-candidates/candidate_1/documents/pdf?kind=${kind}`,
    {
      headers: {
        'x-request-id': 'inbound_request_should_be_ignored',
        'x-correlation-id': 'correlation_billing_document_pdf_1',
      },
    },
  );
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_billing_document_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_billing_document_pdf_1');
}

describe('/api/billing-candidates/[id]/documents/pdf GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
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
    expectRequestTrace(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '請求書類 PDF の閲覧権限がありません',
    });
    expect(buildBillingDocumentPdfMock).toHaveBeenCalledWith('org_1', 'candidate_1', 'receipt');
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'receipt.pdf');
    expect(recordDataExportAuditMock.mock.invocationCallOrder[0]).toBeLessThan(
      pdfResponseMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'billing_receipt',
        targetId: 'candidate_1',
        format: 'pdf',
        requestId: 'request_billing_document_pdf_1',
        correlationId: 'correlation_billing_document_pdf_1',
      }),
    );
  });

  it('rejects unsupported document kinds before rendering', async () => {
    const response = await GET(createRequest('statement'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'kind は receipt または invoice を指定してください',
    });
    expect(buildBillingDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('maps missing candidates to 404', async () => {
    buildBillingDocumentPdfMock.mockRejectedValue(new PdfNotFoundError('billingCandidate'));

    const response = await GET(createRequest('invoice'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildBillingDocumentPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 の請求候補が見つかりません: storage key raw_pdf_1'),
    );

    const response = await GET(createRequest('invoice'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('請求書類 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
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
    expectRequestTrace(response);
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
    expectRequestTrace(response);
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
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('請求書類 PDF を生成できませんでした');
    expect(body).not.toContain('candidate_1 raw billing patient render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed with a distinct traced error when export audit recording fails', async () => {
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'receipt.pdf',
    });
    recordDataExportAuditMock.mockRejectedValue(
      new Error('audit unavailable for 患者 山田太郎 090-1234-5678'),
    );

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED',
      message: '請求書類 PDF 出力監査を記録できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', new PdfNotFoundError('billingCandidate')],
    ['conflict', new Error('BILLING_DOCUMENT_NOT_ISSUED')],
  ])('does not misclassify %s-shaped audit failures', async (_label, cause) => {
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'receipt.pdf',
    });
    recordDataExportAuditMock.mockRejectedValue(cause);

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED',
    });
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns a traced sanitized 500 when response creation fails after the audit', async () => {
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'receipt.pdf',
    });
    const thrownError = new Error('患者 山田花子 090-1234-5678 raw billing response detail');
    pdfResponseMock.mockImplementationOnce(() => {
      throw thrownError;
    });

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
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
    expect(JSON.stringify(body)).not.toContain('raw billing response detail');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/billing-candidates/candidate_1/documents/pdf',
        method: 'GET',
        requestId: 'request_billing_document_pdf_1',
        correlationId: 'correlation_billing_document_pdf_1',
      },
      thrownError,
    );
  });

  it('returns a traced no-store 500 before rendering when the auth dependency throws', async () => {
    const thrownError = new Error('session provider unavailable');
    requireAuthContextMock.mockRejectedValueOnce(thrownError);

    const response = await GET(createRequest('receipt'), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_billing_pdf_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_billing_document_pdf_1');
    expect(buildBillingDocumentPdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/billing-candidates/candidate_1/documents/pdf',
        method: 'GET',
        requestId: 'generated_request_billing_pdf_1',
        correlationId: 'correlation_billing_document_pdf_1',
      },
      thrownError,
    );
  });
});
