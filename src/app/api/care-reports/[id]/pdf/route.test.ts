import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  unstableRethrowMock,
  buildCareReportPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    requestId: 'request_care_report_pdf_1',
    correlationId: 'correlation_care_report_pdf_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  unstableRethrowMock: vi.fn(),
  buildCareReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('next/navigation', () => ({
  unstable_rethrow: unstableRethrowMock,
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
              unstableRethrowMock(error);
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
          unstableRethrowMock(error);
          trace = {
            ...authContext,
            requestId: 'generated_request_care_report_pdf_1',
            correlationId:
              req.headers.get('x-correlation-id') ?? 'generated_request_care_report_pdf_1',
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

import {
  PdfNotFoundError,
  UnsupportedCareReportPdfContentError,
} from '@/server/services/pdf-errors';
import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1/pdf', {
    headers: {
      'x-request-id': 'inbound_request_should_be_ignored',
      'x-correlation-id': 'correlation_care_report_pdf_1',
    },
  });
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_care_report_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_care_report_pdf_1');
}

describe('/api/care-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    unstableRethrowMock.mockImplementation((error) => {
      if (
        error instanceof Error &&
        typeof (error as Error & { digest?: unknown }).digest === 'string' &&
        (error as Error & { digest: string }).digest.startsWith('NEXT_REDIRECT')
      ) {
        throw error;
      }
    });
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered care report pdf', async () => {
    const hostileFileName =
      'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf';
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: hostileFileName,
      reportUpdatedAt: new Date('2026-03-28T09:00:00.000Z'),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canSendCareReport',
      message: '報告書 PDF の出力権限がありません',
    });
    expect(buildCareReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), hostileFileName);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'care_report',
      targetId: 'report_1',
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'care_report_pdf',
        output_profile: 'external_submission_pdf',
        report_updated_at: '2026-03-28T09:00:00.000Z',
      },
      ipAddress: undefined,
      userAgent: undefined,
      requestId: 'request_care_report_pdf_1',
      correlationId: 'correlation_care_report_pdf_1',
    });
    expectPhiExportSnapshotRedacted(JSON.stringify(recordDataExportAuditMock.mock.calls), [
      'Taro',
      'Yamada',
      'storageKey=s3',
    ]);
    expect(buildCareReportPdfMock.mock.invocationCallOrder[0]!).toBeLessThan(
      recordDataExportAuditMock.mock.invocationCallOrder[0]!,
    );
    expect(recordDataExportAuditMock.mock.invocationCallOrder[0]!).toBeLessThan(
      pdfResponseMock.mock.invocationCallOrder[0]!,
    );
  });

  it('returns a traced sanitized 500 when response creation fails after the audit', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'care-report.pdf',
      reportUpdatedAt: new Date('2026-03-28T09:00:00.000Z'),
    });
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw response creation detail');
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
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
    expect(JSON.stringify(body)).not.toContain('raw response creation detail');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/care-reports/report_1/pdf',
        method: 'GET',
        requestId: 'request_care_report_pdf_1',
        correlationId: 'correlation_care_report_pdf_1',
      },
      expect.any(Error),
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
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_care_report_pdf_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_care_report_pdf_1');
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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/care-reports/report_1/pdf',
        method: 'GET',
        requestId: 'generated_request_care_report_pdf_1',
        correlationId: 'correlation_care_report_pdf_1',
      },
      expect.any(Error),
    );
  });

  it('rejects blank report ids before rendering or auditing the export', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
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
    expectRequestTrace(response);
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

  it('rejects unsupported care report PDF content without auditing or exposing raw content details', async () => {
    buildCareReportPdfMock.mockRejectedValue(new UnsupportedCareReportPdfContentError());

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        'この報告書形式は外部提出用PDFとして表示できません。薬剤師が内容を確認し、専用形式で再出力してください。',
    });
    expect(JSON.stringify(body)).not.toContain('source_provenance');
    expect(JSON.stringify(body)).not.toContain('patient_1');
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
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CARE_REPORT_PDF_EXPORT_AUDIT_FAILED',
      message: '報告書 PDF 出力監査を記録できませんでした',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rethrows Next control-flow errors without auditing, logging, or creating a PDF response', async () => {
    const controlFlowError = Object.assign(new Error('redirect'), {
      digest: 'NEXT_REDIRECT;replace;/reports/report_1;307;',
    });
    buildCareReportPdfMock.mockRejectedValueOnce(controlFlowError);

    await expect(
      GET(createRequest(), {
        params: Promise.resolve({ id: 'report_1' }),
      }),
    ).rejects.toBe(controlFlowError);

    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
