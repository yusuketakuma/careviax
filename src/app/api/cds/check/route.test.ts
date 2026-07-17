import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  unstableRethrowMock,
  medicationCycleFindFirstMock,
  checkDispenseAlertsMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  checkDispenseAlertsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: ReturnType<typeof buildAuthContext>,
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
  },
}));

vi.mock('@/server/cds/checker', () => ({
  checkDispenseAlerts: checkDispenseAlertsMock,
}));

import { POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function callPOST(request: NextRequest) {
  return POST(request, emptyRouteContext);
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cds/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/cds/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

function buildAuthContext(req: NextRequest & { role?: string }) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: req.role ?? 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  };
}

describe('/api/cds/check POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
    });
    checkDispenseAlertsMock.mockResolvedValue([
      {
        type: 'high_risk',
        severity: 'warning',
        message: 'ハイリスク薬です',
      },
    ]);
  });

  it('rejects auth before consuming malformed CDS input or loading a cycle', async () => {
    const request = createMalformedJsonRequest();
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'FORBIDDEN', message: '処方安全チェックの実行権限がありません' },
        { status: 403 },
      ),
    });

    const response = await callPOST(request);

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('returns a traced fixed 500 when auth resolution throws', async () => {
    const unsafeError = new Error('患者 山田太郎 CDS auth secret');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);
    const request = new NextRequest('http://localhost/api/cds/check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'untrusted_request_id',
        'x-correlation-id': 'correlation_cds_1',
      },
      body: '{',
    });

    const response = await callPOST(request);

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_cds_1');
    expect(request.bodyUsed).toBe(false);
    expect(JSON.stringify(await response.json())).not.toContain('山田太郎');
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/cds/check',
        method: 'POST',
        requestId: 'generated_request_1',
        correlationId: 'correlation_cds_1',
      },
      unsafeError,
    );
  });

  it('rethrows auth control-flow errors without CDS work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(callPOST(createMalformedJsonRequest())).rejects.toBe(controlFlowError);

    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control-flow errors without invoking CDS or logging', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    medicationCycleFindFirstMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(callPOST(createRequest({ cycleId: 'cycle_1' }))).rejects.toBe(controlFlowError);

    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('accepts requests with cycleId only and resolves patient scope from the cycle', async () => {
    const response = await callPOST(createRequest({ cycleId: 'cycle_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '処方安全チェックの実行権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    for (const [ctx] of runWithRequestAuthContextMock.mock.calls) {
      expect(ctx).toEqual(buildAuthContext(new NextRequest('http://localhost')));
    }
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1' },
      select: { id: true, patient_id: true },
    });
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        alerts: [
          expect.objectContaining({
            type: 'high_risk',
          }),
        ],
      },
    });
    expect(body).not.toHaveProperty('alerts');
  });

  it('ignores a hostile client patientId and scopes CDS to the stored cycle patient', async () => {
    const response = await callPOST(
      createRequest({ cycleId: 'cycle_1', patientId: 'patient_other' }),
    );

    expect(response.status).toBe(200);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1' },
      select: { id: true, patient_id: true },
    });
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
    expect(checkDispenseAlertsMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'patient_other',
    );
  });

  it('returns a fixed 404 without running CDS when the org-scoped cycle is absent', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce(null);

    const response = await callPOST(createRequest({ cycleId: 'cycle_other_org' }));

    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '指定されたサイクルが見つかりません',
    });
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects non-object CDS payloads before loading the cycle', async () => {
    const response = await callPOST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the cycle', async () => {
    const response = await callPOST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when CDS checking fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw cds alert secret');
    unsafeError.name = 'PatientCdsRawAlertSecretError';
    checkDispenseAlertsMock.mockRejectedValueOnce(unsafeError);

    const response = await callPOST(createRequest({ cycleId: 'cycle_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw cds');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/cds/check',
        method: 'POST',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('山田太郎');
    expect(logged).not.toContain('raw cds');
    expect(logged).not.toContain('PatientCdsRawAlertSecretError');
  });
});
