import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  unstableRethrowMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  buildConferenceNotePdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  unstableRethrowMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  buildConferenceNotePdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: ReturnType<typeof buildAuthContext>,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      withRoutePerformanceMock(req, async () => {
        let authResult: { ctx: ReturnType<typeof buildAuthContext> } | { response: Response };
        try {
          authResult = await requireAuthContextMock(req, options);
        } catch (error) {
          unstableRethrowMock(error);
          const trace = {
            requestId: 'generated_request_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_1',
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
          const response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Pragma', 'no-cache');
          response.headers.set('X-Request-Id', trace.requestId);
          response.headers.set('X-Correlation-Id', trace.correlationId);
          return response;
        }

        if ('response' in authResult) {
          authResult.response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          authResult.response.headers.set('Pragma', 'no-cache');
          return authResult.response;
        }

        return runWithRequestAuthContextMock(authResult.ctx, async () => {
          try {
            const response = await handler(req, authResult.ctx, routeContext);
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          } catch (error) {
            unstableRethrowMock(error);
            loggerErrorMock(
              {
                event: 'route_handler_unhandled_error',
                route: req.nextUrl.pathname,
                method: req.method,
                requestId: authResult.ctx.requestId,
                correlationId: authResult.ctx.correlationId,
              },
              error,
            );
            const response = NextResponse.json(
              { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
              { status: 500 },
            );
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          }
        });
      }),
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({ logger: { error: loggerErrorMock } }));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildConferenceNotePdf: buildConferenceNotePdfMock,
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
  return new NextRequest('http://localhost/api/conference-notes/note_1/pdf');
}

function buildAuthContext() {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_conference_pdf_1',
    correlationId: 'correlation_conference_pdf_1',
  };
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_conference_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_conference_pdf_1');
}

describe('/api/conference-notes/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: buildAuthContext() });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered conference note pdf', async () => {
    const hostileFileName =
      'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf';
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: hostileFileName,
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: 'カンファレンス記録 PDF の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      buildAuthContext(),
      expect.any(Function),
    );
    expect(buildConferenceNotePdfMock).toHaveBeenCalledWith('org_1', 'note_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), hostileFileName);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'conference_note',
      targetId: 'note_1',
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'conference_note_pdf',
        output_profile: 'internal_pdf',
      },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'request_conference_pdf_1',
      correlationId: 'correlation_conference_pdf_1',
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

  it('returns a traced sanitized 500 when response creation fails after the audit', async () => {
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'conference-note.pdf',
    });
    const unsafeError = new Error('患者 山田花子 090-1234-5678 raw conference response detail');
    pdfResponseMock.mockImplementationOnce(() => {
      throw unsafeError;
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
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
    expect(JSON.stringify(body)).not.toContain('raw conference response detail');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/conference-notes/note_1/pdf',
        method: 'GET',
        requestId: 'request_conference_pdf_1',
        correlationId: 'correlation_conference_pdf_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田花子');
  });

  it('fails closed when the conference note PDF export audit cannot be recorded', async () => {
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'conference-note.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 provider raw error'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONFERENCE_NOTE_PDF_EXPORT_AUDIT_FAILED',
      message: 'カンファレンス記録 PDF 出力監査を記録できませんでした',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rejects blank conference note ids before rendering or auditing the export', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録IDが不正です',
    });
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the conference note is missing', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(new PdfNotFoundError('conferenceNote'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 のカンファレンス記録が見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('カンファレンス記録 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects authentication before resolving params, rendering, or auditing', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = (await GET(createRequest(), { params }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: 'カンファレンス記録 PDF の閲覧権限がありません',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace PHI-safe 500 before params when authentication throws', async () => {
    const unsafeError = new Error('患者 山田太郎 raw conference auth secret');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = (await GET(createRequest(), { params }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('generated_request_1');
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/conference-notes/note_1/pdf',
        method: 'GET',
        requestId: 'generated_request_1',
        correlationId: 'generated_request_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田太郎');
  });

  it('rethrows authentication control-flow without logging or PDF side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest(), { params: Promise.resolve({ id: 'note_1' }) })).rejects.toBe(
      controlFlowError,
    );

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rethrows render control-flow without logging, auditing, or delivering a PDF', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    buildConferenceNotePdfMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      throw error;
    });

    await expect(GET(createRequest(), { params: Promise.resolve({ id: 'note_1' }) })).rejects.toBe(
      controlFlowError,
    );

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(
      new Error('note_1 raw conference patient render failure'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('カンファレンス記録 PDF を生成できませんでした');
    expect(body).not.toContain('note_1 raw conference patient render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
