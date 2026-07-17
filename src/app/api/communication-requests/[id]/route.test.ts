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
  communicationRequestTxFindFirstMock,
  communicationRequestUpdateManyMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  tracingReportFindFirstMock,
  tracingReportUpdateManyMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  fetchEmergencyContactsMock,
  recordPhiReadAuditForRequestMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  unstableRethrowMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestTxFindFirstMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  fetchEmergencyContactsMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
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
  logger: { error: loggerErrorMock },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findFirst: communicationRequestFindFirstMock,
    },
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    communicationResponse: {
      findFirst: communicationResponseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/emergency-contacts', () => ({
  fetchEmergencyContacts: fetchEmergencyContactsMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

import { GET, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const CURRENT_UPDATED_AT_DATE = new Date(CURRENT_UPDATED_AT);
const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

function createGetRequest() {
  return new NextRequest('http://localhost/api/communication-requests/request_1');
}

function createRequest(body: unknown, headers?: Record<string, string>) {
  const requestBody =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/communication-requests/request_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(requestBody),
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/communication-requests/request_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: '{"status":',
  });
}

async function expectNeutralLinkedTracingReportValidationError(response: Response) {
  expect(response.status).toBe(400);
  expectSensitiveNoStore(response);
  await expect(response.json()).resolves.toEqual({
    code: 'VALIDATION_ERROR',
    message: '入力値が不正です',
    details: {
      related_entity_id: ['指定された関連先を確認できません'],
    },
  });
}

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'response_intent_key'] },
  });
}

function buildAuthContext(
  overrides: Partial<{
    orgId: string;
    userId: string;
    role: string;
  }> = {},
) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_1',
    correlationId: 'correlation_1',
    ...overrides,
  };
}

function resetAuthWrapperMocks() {
  requireAuthContextMock.mockResolvedValue({ ctx: buildAuthContext() });
  runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
  withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
  unstableRethrowMock.mockImplementation(() => undefined);
}

describe('/api/communication-requests/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthWrapperMocks();
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    fetchEmergencyContactsMock.mockResolvedValue([{ id: 'contact_1', name: '家族A' }]);
  });

  it('loads request content and suggested contacts after assignment access succeeds', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
        subject: '確認事項',
        content: '処方内容を確認したいです',
        responses: [{ id: 'response_1', content: '承知しました' }],
      });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      buildAuthContext(),
      expect.any(Function),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'request_1',
        subject: '確認事項',
        suggested_contacts: [{ id: 'contact_1', name: '家族A' }],
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'request_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        related_entity_type: true,
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'request_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          related_entity_type: null,
        },
        select: expect.objectContaining({
          subject: true,
          content: true,
          responses: expect.objectContaining({
            orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
            select: expect.objectContaining({ content: true }),
          }),
        }),
      }),
    );
    expect(fetchEmergencyContactsMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'patient_1',
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'communication_request',
        targetId: 'request_1',
        view: 'communication_request_detail',
      },
    );
  });

  it('rejects blank request ids before loading communication content', async () => {
    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns the same neutral GET 404 for missing and assignment-denied requests', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: buildAuthContext({ userId: 'driver_1', role: 'driver' }),
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: null,
    });
    careCaseFindFirstMock.mockResolvedValue(null);

    const missingResponse = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });
    const deniedResponse = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(missingResponse.status).toBe(404);
    expect(deniedResponse.status).toBe(404);
    expectSensitiveNoStore(missingResponse);
    expectSensitiveNoStore(deniedResponse);
    await expect(missingResponse.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '依頼が見つかりません',
    });
    await expect(deniedResponse.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '依頼が見つかりません',
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(2);
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects care report communication content for callers without report send permission', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: buildAuthContext({ userId: 'clerk_1', role: 'clerk' }),
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'care_report',
    });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(1);
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('loads communication content for an org-wide role regardless of case assignment', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
        subject: '確認事項',
        content: '処方内容を確認したいです',
        responses: [],
      });
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'request_1', subject: '確認事項' },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(2);
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'request_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        related_entity_type: true,
      },
    });
    expect(fetchEmergencyContactsMock).toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'communication_request',
        targetId: 'request_1',
        view: 'communication_request_detail',
      },
    );
  });

  it('returns no detail or audit when the request scope changes after access validation', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
      })
      .mockResolvedValueOnce(null);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'request_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          related_entity_type: null,
        },
      }),
    );
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not resolve params, read content, or audit when GET authentication is rejected', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    });
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = await GET(createGetRequest(), { params });

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の閲覧権限がありません',
    });
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a traced PHI-safe GET 500 before params when authentication throws', async () => {
    const unsafeError = new Error('患者 山田花子 090-1234-5678 auth raw detail');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = await GET(createGetRequest(), { params });

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
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/communication-requests/request_1',
        method: 'GET',
        requestId: 'generated_request_1',
        correlationId: 'generated_request_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田花子');
  });

  it('rethrows GET authentication control-flow without logging or PHI side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(createGetRequest(), { params: Promise.resolve({ id: 'request_1' }) }),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when request lookup fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田花子 090-1234-5678 raw care coordination detail');
    communicationRequestFindFirstMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('raw care coordination detail');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/communication-requests/request_1',
        method: 'GET',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田花子');
  });
});

describe('/api/communication-requests/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthWrapperMocks();
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: null,
      related_entity_id: null,
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [],
    });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_1' });
    tracingReportUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          updateMany: communicationRequestUpdateManyMock,
          findFirst: communicationRequestTxFindFirstMock,
        },
        communicationResponse: {
          findFirst: communicationResponseFindFirstMock,
          create: communicationResponseCreateMock,
        },
        tracingReport: {
          updateMany: tracingReportUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects PATCH before resolving params, reading the body, or entering request context', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'FORBIDDEN', message: '拒否されました' },
        { status: 403 },
      ),
    });
    const request = createMalformedJsonRequest();
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = await PATCH(request, { params });

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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth context fails before mutation work', async () => {
    const unsafeError = new Error('患者 山田花子 090-1234-5678 communication update raw detail');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);
    const request = createMalformedJsonRequest({
      'x-org-id': 'org_1',
      'x-correlation-id': 'incoming_correlation_1',
    });
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;

    const response = await PATCH(request, { params });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('incoming_correlation_1');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('communication update raw detail');
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/communication-requests/request_1',
        method: 'PATCH',
        requestId: 'generated_request_1',
        correlationId: 'incoming_correlation_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田花子');
  });

  it('rejects care report communication mutations for callers without report send permission', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: buildAuthContext({ userId: 'clerk_1', role: 'clerk' }),
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: 'care_report',
      related_entity_id: 'report_1',
    });

    const response = await PATCH(
      createRequest({
        status: 'responded',
        status_change_reason: '医師から返信あり',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns the same neutral PATCH 404 for missing and assignment-denied requests', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: buildAuthContext({ userId: 'driver_1', role: 'driver' }),
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce(null);
    careCaseFindFirstMock.mockResolvedValue(null);
    const patchBody = {
      status: 'in_progress',
      status_change_reason: '電話で受領確認し対応を開始',
    };

    const missingResponse = await PATCH(createRequest(patchBody), {
      params: Promise.resolve({ id: 'request_1' }),
    });
    const deniedResponse = await PATCH(createRequest(patchBody), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(missingResponse.status).toBe(404);
    expect(deniedResponse.status).toBe(404);
    expectSensitiveNoStore(missingResponse);
    expectSensitiveNoStore(deniedResponse);
    await expect(missingResponse.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '依頼が見つかりません',
    });
    await expect(deniedResponse.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '依頼が見つかりません',
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(2);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid status transitions', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'draft',
      updated_at: CURRENT_UPDATED_AT_DATE,
    });

    const response = await PATCH(
      createRequest(
        { status: 'received', status_change_reason: '受領確認として更新' },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'draft から received へは遷移できません',
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires a reason for direct status changes', async () => {
    const response = await PATCH(
      createRequest({ status: 'in_progress' }, { 'x-org-id': 'org_1' }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ステータス変更理由は必須です',
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the request for mutation work', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: undefined,
          status: 'in_progress',
          status_change_reason: '電話で受領確認し対応を開始',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict for stale expected_updated_at before response or audit side effects', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: '2026-06-17T23:59:59.000Z',
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('replays an existing PATCH response when the retry carries the original version', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'responded',
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
        related_entity_type: null,
        related_entity_id: null,
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'responded',
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
        responses: [{ id: 'response_existing' }],
      });
    communicationResponseFindFirstMock.mockResolvedValueOnce({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: CURRENT_UPDATED_AT,
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'request_1',
        responses: [{ id: 'response_existing' }],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the request', async () => {
    const response = await PATCH(createRequest(['unexpected'], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank request ids before loading or updating the request', async () => {
    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the request', async () => {
    const response = await PATCH(createMalformedJsonRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank response fields before loading the request', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '   ',
            content: '   ',
            responded_at: '   ',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects response content above the clinical note length cap before loading the request', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: 'あ'.repeat(4001),
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        response: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('records an audit log with the reason for direct status changes', async () => {
    const response = await PATCH(
      createRequest(
        { status: ' in_progress ', status_change_reason: ' 電話で受領確認し対応を開始 ' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の更新権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      buildAuthContext(),
      expect.any(Function),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: buildAuthContext(),
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'in_progress' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'communication_request_status_changed',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'in_progress',
          reason: '電話で受領確認し対応を開始',
        }),
      }),
    });
  });

  it('returns a sanitized no-store 500 when the update transaction fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田花子 090-1234-5678 raw transaction detail');
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('raw transaction detail');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/communication-requests/request_1',
        method: 'PATCH',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田花子');
  });

  it('rethrows PATCH handler control-flow without logging or mutation side effects', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    communicationRequestFindFirstMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      PATCH(
        createRequest({
          status: 'in_progress',
          status_change_reason: '電話で受領確認し対応を開始',
        }),
        { params: Promise.resolve({ id: 'request_1' }) },
      ),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before request update, response creation, tracing sync, or audit', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('records a response and auto-advances to responded', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: ' 在宅主治医 ',
            content: ' 現行処方で継続 ',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_request_status_changed',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'responded',
          reason: 'communication_response_recorded',
          response_id: 'response_1',
        }),
      }),
    });
  });

  it('returns conflict without creating a response when the request status changes concurrently', async () => {
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('reuses an existing response for the same retry payload without creating another row', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('touches and audits an already-responded request when PATCH records a different new response', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_new' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [{ id: 'response_new' }],
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '薬剤部B',
            content: '追加確認しました',
            responded_at: '2026-03-29T00:05:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
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
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '追加確認しました',
    );
  });

  it('reuses an existing inline response retry even when responded_at was omitted', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    const query = communicationResponseFindFirstMock.mock.calls[0]?.[0];
    const intentKey = query?.where.OR[0].response_intent_key;
    expect(intentKey).toEqual(expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/));
    expect(query?.where.OR[1].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
    );
    expect(query).toMatchObject({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        OR: [
          { response_intent_key: intentKey },
          {
            response_intent_key: query?.where.OR[1].response_intent_key,
          },
          {
            response_intent_key: null,
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        ],
      },
    });
    expect(query?.where.OR[2].responded_at).toBeInstanceOf(Date);
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the concurrently inserted response when the PATCH response intent key wins the race', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'response_race',
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the generic linked validation error when a tracing report is missing or outside the organization', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_missing',
    });
    tracingReportFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    await expectNeutralLinkedTracingReportValidationError(response);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'tracing_missing', org_id: 'org_1' },
      select: expect.any(Object),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('updates and audits a linked tracing report only after scope consistency is verified', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
      recipient_name: '在宅主治医',
      status: 'responded',
      responses: [],
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        sent_at: true,
        acknowledged_at: true,
      },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        target_type: 'tracing_report',
        target_id: 'tracing_1',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'acknowledged',
          reason: 'communication_response_recorded',
          linked_communication_request_id: 'request_1',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(auditLogCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          reason: '現行処方で継続',
        }),
      }),
    });
  });

  it('returns conflict before response or audit side effects when the linked tracing report changes concurrently', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    tracingReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('encodes only the linked tracing report pdf_url and keeps identity fields raw', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: HOSTILE_TRACING_REPORT_ID,
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'tracing_report',
      related_entity_id: HOSTILE_TRACING_REPORT_ID,
      recipient_name: '在宅主治医',
      status: 'responded',
      responses: [],
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: HOSTILE_TRACING_REPORT_ID,
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: HOSTILE_TRACING_REPORT_ID,
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        sent_at: true,
        acknowledged_at: true,
      },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: HOSTILE_TRACING_REPORT_ID,
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: HOSTILE_TRACING_REPORT_PDF_URL,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        target_id: HOSTILE_TRACING_REPORT_ID,
        changes: expect.objectContaining({
          linked_communication_request_id: 'request_1',
        }),
      }),
    });
  });

  it('rejects cross-case linked tracing reports before response, status, or audit side effects', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    await expectNeutralLinkedTracingReportValidationError(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the same generic linked validation error when tracing report assignment access is denied', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: buildAuthContext({ userId: 'driver_1', role: 'driver' }),
    });
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: null,
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1', archived_at: null });
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    await expectNeutralLinkedTracingReportValidationError(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('lets an org-wide role respond through a linked tracing report in any in-org case', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: null,
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    careCaseFindFirstMock.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === 'case_2' ? null : { id: args.where.id ?? 'case_1' },
    );

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });

  it('lets an org-wide role respond regardless of case assignment', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });
});
