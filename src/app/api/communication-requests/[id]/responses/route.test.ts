import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  unstableRethrowMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  communicationRequestFindFirstMock,
  communicationResponseFindManyMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  communicationRequestUpdateManyMock,
  communicationRequestTxFindFirstMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  unstableRethrowMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  communicationRequestFindFirstMock: vi.fn(),
  communicationResponseFindManyMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationRequestTxFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: {
          orgId: string;
          userId: string;
          role: string;
          ipAddress: string;
          userAgent: string;
          requestId: string;
          correlationId: string;
        },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      withRoutePerformanceMock(req, async () => {
        let authResult:
          | {
              ctx: {
                orgId: string;
                userId: string;
                role: string;
                ipAddress: string;
                userAgent: string;
                requestId: string;
                correlationId: string;
              };
            }
          | { response: Response };
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
    communicationRequest: {
      findFirst: communicationRequestFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    communicationResponse: {
      findMany: communicationResponseFindManyMock,
      findFirst: communicationResponseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const REQUEST_UPDATED_AT = new Date('2026-03-28T09:00:00.000Z');
const REQUEST_UPDATED_AT_ISO = REQUEST_UPDATED_AT.toISOString();

function createGetRequest(requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`);
}

function createPostRequest(body: unknown, requestId = 'request_1') {
  const effectiveBody =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: REQUEST_UPDATED_AT_ISO, ...body }
      : body;
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(effectiveBody),
  } satisfies NextRequestInit);
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

describe('/api/communication-requests/[id]/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    communicationResponseFindManyMock.mockResolvedValue([{ id: 'response_1' }]);
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_2' });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: new Date('2026-03-28T09:01:00.000Z'),
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationResponse: {
          findFirst: communicationResponseFindFirstMock,
          create: communicationResponseCreateMock,
        },
        communicationRequest: {
          updateMany: communicationRequestUpdateManyMock,
          findFirst: communicationRequestTxFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists responses for a communication request', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
      data: [{ id: 'response_1' }],
      meta: { request_updated_at: REQUEST_UPDATED_AT_ISO },
    });
    expect(communicationResponseFindManyMock).toHaveBeenCalledWith({
      where: { request_id: 'request_1', org_id: 'org_1' },
      orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
    });
  });

  it('rejects GET before resolving params or entering request context when authentication fails', async () => {
    const authResponse = NextResponse.json(
      { code: 'FORBIDDEN', message: '拒否されました' },
      { status: 403 },
    );
    requireAuthContextMock.mockResolvedValueOnce({ response: authResponse });
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = (await GET(createGetRequest(), { params }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の閲覧権限がありません',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized traced GET 500 without resolving params when authentication throws', async () => {
    const unsafeError = new Error('患者 山田太郎 authentication secret');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = (await GET(createGetRequest(), { params }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('generated_request_1');
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/communication-requests/request_1/responses',
        method: 'GET',
        requestId: 'generated_request_1',
        correlationId: 'generated_request_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田太郎');
  });

  it('rethrows GET authentication control-flow errors without logging or side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(createGetRequest(), { params: Promise.resolve({ id: 'request_1' }) }),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects care report response reads when the caller cannot send reports', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: 'care_report',
    });

    const response = (await GET(Object.assign(createGetRequest(), { role: 'clerk' }), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(communicationResponseFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank request ids before listing responses', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(communicationResponseFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when response listing fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw communication response content facility memo');
    unsafeError.name = 'CommunicationResponseListSecretError';
    communicationResponseFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw communication response');
    expect(JSON.stringify(body)).not.toContain('facility memo');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/communication-requests/request_1/responses',
        method: 'GET',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('山田太郎');
    expect(logged).not.toContain('raw communication response');
    expect(logged).not.toContain('CommunicationResponseListSecretError');
  });

  it('creates a response and updates the request status', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の更新権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    const payload = await response.clone().json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
      data: { id: 'response_2' },
      meta: { request_updated_at: '2026-03-28T09:01:00.000Z' },
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'sent',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { status: 'responded' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'sent',
          to_status: 'responded',
          response_id: 'response_2',
          response_created: true,
          response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
          responder_name: '医師A',
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 6,
          responded_at: '2026-03-29T00:00:00.000Z',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '確認しました',
    );
  });
});
