import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
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

import { POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const REQUEST_UPDATED_AT = new Date('2026-03-28T09:00:00.000Z');
const REQUEST_UPDATED_AT_ISO = REQUEST_UPDATED_AT.toISOString();

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

function createMalformedJsonPostRequest(requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"responder_name":',
  } satisfies NextRequestInit);
}

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'response_intent_key'] },
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

  it('rejects POST before resolving params or reading the body when authentication fails', async () => {
    const authResponse = NextResponse.json(
      { code: 'FORBIDDEN', message: '拒否されました' },
      { status: 403 },
    );
    requireAuthContextMock.mockResolvedValueOnce({ response: authResponse });
    const request = createMalformedJsonPostRequest();
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = (await POST(request, { params }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の更新権限がありません',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
  });

  it('rethrows POST handler control-flow errors without logging or audit side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    communicationRequestFindFirstMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      POST(
        createPostRequest({
          responder_name: '医師A',
          content: '確認しました',
          responded_at: '2026-03-29T00:00:00.000Z',
        }),
        { params: Promise.resolve({ id: 'request_1' }) },
      ),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when response creation fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw communication response create secret');
    unsafeError.name = 'CommunicationResponseCreateSecretError';
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/communication-requests/request_1/responses',
        method: 'POST',
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
    expect(logged).not.toContain('CommunicationResponseCreateSecretError');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects care report response writes when the caller cannot send reports', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      related_entity_type: 'care_report',
    });

    const response = (await POST(
      Object.assign(
        createPostRequest({
          responder_name: '医師A',
          content: '確認しました',
          responded_at: '2026-03-29T00:00:00.000Z',
        }),
        { role: 'clerk' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before creating response records or updating request status', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

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

    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without creating a response when the request status changes concurrently', async () => {
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('requires the request version before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        expected_updated_at: undefined,
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale response creation before updating request status', async () => {
    const response = (await POST(
      createPostRequest({
        expected_updated_at: '2026-03-28T08:00:00.000Z',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('replays an existing response when a successful retry carries the original version', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: new Date('2026-03-28T09:01:00.000Z'),
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValueOnce({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

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

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
      data: { id: 'response_existing' },
      meta: { request_updated_at: '2026-03-28T09:01:00.000Z' },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-datetime responded_at values before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        responded_at: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects response content above the clinical note length cap before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: 'あ'.repeat(4001),
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        content: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank request ids before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('normalizes response text fields before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: ' 医師A ',
        content: ' 確認しました ',
        responded_at: ' 2026-03-29T00:00:00.000Z ',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      }),
    });
  });

  it('returns an existing response for the same retry payload without creating another row', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: REQUEST_UPDATED_AT,
    });

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_existing' },
      meta: { request_updated_at: REQUEST_UPDATED_AT_ISO },
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'request_1',
        org_id: 'org_1',
      },
      select: { updated_at: true },
    });
    const query = communicationResponseFindFirstMock.mock.calls[0]?.[0];
    expect(query?.where).toMatchObject({
      org_id: 'org_1',
      request_id: 'request_1',
    });
    expect(query?.where.OR[0].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
    );
    expect(query?.where.OR[1].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
    );
    expect(query?.where.OR[2]).toMatchObject({
      response_intent_key: null,
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('touches and audits an already-responded request when a different new response is recorded', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_new' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: new Date('2026-03-28T09:02:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        responder_name: '薬剤部B',
        content: '追加確認しました',
        responded_at: '2026-03-29T00:05:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_new' },
      meta: { request_updated_at: '2026-03-28T09:02:00.000Z' },
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        changes: expect.objectContaining({
          from_status: 'responded',
          to_status: 'responded',
          response_id: 'response_new',
          response_created: true,
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 8,
        }),
      }),
    });
  });

  it('returns the concurrently inserted response when the response intent key wins the race', async () => {
    communicationResponseFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'response_race',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_race' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    const createData = communicationResponseCreateMock.mock.calls[0]?.[0]?.data;
    expect(communicationResponseFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        response_intent_key: createData.response_intent_key,
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'sent',
          to_status: 'responded',
          response_id: 'response_race',
          response_created: false,
          response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 6,
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '確認しました',
    );
  });

  it('returns the concurrently inserted response without a duplicate audit when already responded', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'response_race',
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: REQUEST_UPDATED_AT,
    });

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_race' },
      meta: { request_updated_at: REQUEST_UPDATED_AT_ISO },
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank response fields before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '   ',
        content: '   ',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the request', async () => {
    const response = (await POST(createPostRequest(['unexpected']), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the request', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('lets an org-wide role create a response without assignment scoping', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

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
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });
});
