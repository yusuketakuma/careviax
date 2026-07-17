import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withAuthContextOptions,
  buildTracingReportPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withAuthContextOptions: [] as unknown[],
  buildTracingReportPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: ReturnType<typeof buildAuthContext>,
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    withAuthContextOptions.push(options);
    return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) {
        authResult.response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        authResult.response.headers.set('Pragma', 'no-cache');
        return authResult.response;
      }

      const response = await handler(req, authResult.ctx, routeContext);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('X-Request-Id', authResult.ctx.requestId);
      response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
      return response;
    };
  },
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildTracingReportPdf: buildTracingReportPdfMock,
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
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

function createRequest() {
  return new NextRequest('http://localhost/api/tracing-reports/report_1/pdf');
}

function buildAuthContext() {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    requestId: 'request_tracing_pdf_1',
    correlationId: 'correlation_tracing_pdf_1',
  };
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_tracing_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_tracing_pdf_1');
}

describe('/api/tracing-reports/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: buildAuthContext() });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('registers the dynamic wrapper with the exact report permission contract', () => {
    expect(withAuthContextOptions).toEqual([
      {
        permission: 'canReport',
        message: 'トレーシングレポート PDF の閲覧権限がありません',
      },
    ]);
  });

  it('rejects blank tracing report ids before rendering or audit', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'トレーシングレポートIDが不正です',
    });
    expect(buildTracingReportPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns the rendered tracing report pdf', async () => {
    const hostileFileName =
      'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf';
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: hostileFileName,
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildTracingReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), hostileFileName);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'tracing_report',
      targetId: 'report_1',
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'tracing_report_pdf',
        output_profile: 'internal_pdf',
      },
      ipAddress: undefined,
      userAgent: undefined,
      requestId: 'request_tracing_pdf_1',
      correlationId: 'correlation_tracing_pdf_1',
    });
    expectPhiExportSnapshotRedacted(JSON.stringify(recordDataExportAuditMock.mock.calls), [
      'Taro',
      'Yamada',
      'storageKey=s3',
    ]);
    expect(recordDataExportAuditMock.mock.invocationCallOrder[0]).toBeLessThan(
      pdfResponseMock.mock.invocationCallOrder[0]!,
    );
  });

  it('leaves unexpected response creation failures to the shared wrapper after the audit', async () => {
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'tracing-report.pdf',
    });
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw tracing response detail');
    });

    await expect(
      GET(createRequest(), {
        params: Promise.resolve({ id: 'report_1' }),
      }),
    ).rejects.toThrow('患者 山田花子 090-1234-5678 raw tracing response detail');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the tracing report PDF export audit cannot be recorded', async () => {
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'tracing-report.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 090-1234-5678'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'TRACING_REPORT_PDF_EXPORT_AUDIT_FAILED',
      message: 'トレーシングレポート PDF 出力監査を記録できませんでした',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns 404 without rendering or audit when the tracing report is not accessible', async () => {
    buildTracingReportPdfMock.mockRejectedValue(new PdfNotFoundError('tracingReport'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildTracingReportPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildTracingReportPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 のトレーシングレポートが見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('トレーシングレポート PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
