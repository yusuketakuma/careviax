import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  withOrgContextMock,
  findFirstMock,
  auditLogCreateMock,
  reviewBillingCandidateMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  reviewBillingCandidateMock: vi.fn(),
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
          response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
        }
        response.headers.set('Cache-Control', SENSITIVE_NO_STORE);
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', trace.requestId);
        response.headers.set('X-Correlation-Id', trace.correlationId);
        return response;
      }),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  reviewBillingCandidate: reviewBillingCandidateMock,
}));

import { PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-06-17T00:00:00.000Z';
const SENSITIVE_NO_STORE = 'private, no-store, max-age=0';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'x-request-id': 'inbound_request_should_be_ignored',
      'x-correlation-id': 'correlation_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1', {
    method: 'PATCH',
    body: '{"action":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'x-request-id': 'inbound_request_should_be_ignored',
      'x-correlation-id': 'correlation_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe(SENSITIVE_NO_STORE);
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/billing-candidates/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    findFirstMock.mockResolvedValue({
      id: 'candidate_1',
      status: 'candidate',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    auditLogCreateMock.mockResolvedValue({});
    reviewBillingCandidateMock.mockResolvedValue({
      id: 'candidate_1',
      status: 'confirmed',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findFirst: findFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('confirms a candidate and records the audit trail', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: '  candidate_1  ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '請求候補の更新権限がありません',
    });
    expect(reviewBillingCandidateMock).toHaveBeenCalledWith(
      {
        billingCandidate: { findFirst: findFirstMock },
        auditLog: { create: auditLogCreateMock },
      },
      {
        orgId: 'org_1',
        billingCandidateId: 'candidate_1',
        action: 'confirm',
        note: null,
        actorId: 'user_1',
        expectedUpdatedAt: new Date(CURRENT_UPDATED_AT),
      },
    );
    expect(auditLogCreateMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'candidate_1',
        status: 'confirmed',
      },
    });
  });

  it('accepts a null note for existing clients while using expected_updated_at', async () => {
    const response = await PATCH(
      createRequest({
        action: 'exclude',
        expected_updated_at: CURRENT_UPDATED_AT,
        note: null,
      }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(reviewBillingCandidateMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: 'exclude',
        note: null,
        expectedUpdatedAt: new Date(CURRENT_UPDATED_AT),
      }),
    );
  });

  it('rejects blank candidate ids before parsing request bodies or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects updates for exported candidates', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      status: 'exported',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before transaction or audit work', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict for stale expected_updated_at before review or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: STALE_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(findFirstMock).toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without audit work when the review service detects a stale race', async () => {
    reviewBillingCandidateMock.mockRejectedValueOnce(new Error('BILLING_CANDIDATE_STALE'));

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(reviewBillingCandidateMock).toHaveBeenCalledOnce();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid review action before transaction or audit work', async () => {
    const response = await PATCH(
      createRequest({ action: 'delete', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before transaction or audit work', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction or audit work', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found without audit work when the candidate is missing', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'missing_candidate' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(reviewBillingCandidateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns auth rejections with sensitive no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns sanitized no-store 500 responses and skips audit when the review service throws unexpectedly', async () => {
    const rawErrorMessage =
      'review service failed for 患者A 保険者番号=12345678 請求候補=candidate_1';
    const thrownError = new Error(rawErrorMessage);
    reviewBillingCandidateMock.mockRejectedValueOnce(thrownError);

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain(rawErrorMessage);
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('12345678');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/billing-candidates/candidate_1',
        method: 'PATCH',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
  });

  it('returns a traced no-store 500 before parsing when the auth dependency throws', async () => {
    const thrownError = new Error('session provider unavailable');
    requireAuthContextMock.mockRejectedValueOnce(thrownError);

    const response = await PATCH(
      createRequest({ action: 'confirm', expected_updated_at: CURRENT_UPDATED_AT }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/billing-candidates/candidate_1',
        method: 'PATCH',
        requestId: 'generated_request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
  });
});
