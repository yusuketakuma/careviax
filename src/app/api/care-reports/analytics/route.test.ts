import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  unstableRethrowMock,
  getCareReportDeliveryAnalyticsMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  unstableRethrowMock: vi.fn(),
  getCareReportDeliveryAnalyticsMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      withRoutePerformanceMock(req, async () => {
        let authResult: { ctx: typeof authContext } | { response: Response };
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

vi.mock('@/server/services/report-reminders', () => ({
  getCareReportDeliveryAnalytics: getCareReportDeliveryAnalyticsMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url = 'http://localhost/api/care-reports/analytics') {
  return new NextRequest(url, {
    headers: {
      'x-request-id': 'untrusted_request_id',
      'x-correlation-id': 'correlation_1',
    },
  });
}

function callGET(request: NextRequest) {
  return GET(request, emptyRouteContext);
}

describe('/api/care-reports/analytics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    unstableRethrowMock.mockImplementation(() => undefined);
    withOrgContextMock.mockImplementation((_orgId, callback) =>
      callback({ __scopedTx: true } as never),
    );
    getCareReportDeliveryAnalyticsMock.mockResolvedValue({
      summary: {
        current_month: '2026-03',
        current_month_attempted_count: 4,
        current_month_success_rate: 75,
        current_month_failed_count: 1,
        current_month_confirmed_rate: 50,
        overdue_waiting_count: 2,
        overdue_threshold_days: 7,
      },
      monthly_trend: [],
      physician_breakdown: [],
      channel_breakdown: [],
      overdue_waiting: [],
    });
  });

  it('returns report delivery analytics with threshold parsing', async () => {
    const response = await callGET(
      createRequest('http://localhost/api/care-reports/analytics?overdue_days=10'),
    );

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(200);
    expectSensitiveNoStore(ensuredResponse);
    expect(ensuredResponse.headers.get('X-Request-Id')).toBe('request_1');
    expect(ensuredResponse.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(getCareReportDeliveryAnalyticsMock).toHaveBeenCalledWith(
      'org_1',
      {
        overdueDays: 10,
      },
      { __scopedTx: true },
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canSendCareReport',
      message: '報告書分析の閲覧権限がありません',
    });
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      data: {
        summary: {
          overdue_threshold_days: 7,
        },
      },
    });
  });

  it('rejects malformed overdue day values before loading analytics', async () => {
    const response = await callGET(
      createRequest('http://localhost/api/care-reports/analytics?overdue_days=1e1'),
    );

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        overdue_days: ['overdue_days は整数で指定してください'],
      },
    });
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'padded overdue_days',
      'http://localhost/api/care-reports/analytics?overdue_days=%2010%20',
      { overdue_days: ['overdue_days は整数で指定してください'] },
    ],
    [
      'duplicate overdue_days',
      'http://localhost/api/care-reports/analytics?overdue_days=7&overdue_days=10',
      { overdue_days: ['overdue_days は1つだけ指定してください'] },
    ],
  ])('rejects %s before loading analytics', async (_name, url, details) => {
    const response = await callGET(createRequest(url));

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details,
    });
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it.each(['0', '91'])('rejects out-of-range overdue_days=%s before RLS', async (value) => {
    const response = await callGET(
      createRequest(`http://localhost/api/care-reports/analytics?overdue_days=${value}`),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: { overdue_days: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
  });

  it('requires care report send permission before loading delivery contacts', async () => {
    const deniedResponse = NextResponse.json(
      { code: 'FORBIDDEN', message: '報告書分析の閲覧権限がありません' },
      {
        status: 403,
        headers: {
          'X-Request-Id': 'request_1',
          'X-Correlation-Id': 'correlation_1',
        },
      },
    );
    requireAuthContextMock.mockResolvedValueOnce({
      response: deniedResponse,
    });

    const response = await callGET(
      createRequest('http://localhost/api/care-reports/analytics?overdue_days=invalid'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth context fails before analytics load', async () => {
    const thrownError = new Error('raw analytics auth patient 山田 花子 token secret');
    requireAuthContextMock.mockRejectedValueOnce(thrownError);

    const response = await callGET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    const payload = await response.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const payloadText = JSON.stringify(payload);
    expect(payloadText).not.toContain('raw analytics auth');
    expect(payloadText).not.toContain('山田 花子');
    expect(payloadText).not.toContain('token secret');
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/care-reports/analytics',
        method: 'GET',
        requestId: 'generated_request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
  });

  it('returns a fixed no-store 500 envelope when analytics loading throws', async () => {
    const thrownError = new Error('raw physician analytics failure');
    getCareReportDeliveryAnalyticsMock.mockRejectedValueOnce(thrownError);

    const response = await callGET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    const payload = await response.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(payload)).not.toContain('raw physician analytics failure');
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/care-reports/analytics',
        method: 'GET',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('raw physician');
  });

  it('rethrows auth control-flow errors before analytics work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(callGET(createRequest())).rejects.toBe(controlFlowError);

    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control-flow errors without logging or analytics load', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    withOrgContextMock.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(callGET(createRequest())).rejects.toBe(controlFlowError);

    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
