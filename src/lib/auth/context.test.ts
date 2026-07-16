import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  userFindUniqueMock,
  resolveLocalUserByIdentityMock,
  loggerErrorMock,
  logSecurityEventMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  logSecurityEventMock: vi.fn(),
}));

vi.mock('./config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
    user: { findUnique: userFindUniqueMock },
  },
}));
vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('./security-events', () => ({ logSecurityEvent: logSecurityEventMock }));
vi.mock('./user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));

import { requireAuthContext, withAuthContext } from './context';

const routeContext = { params: Promise.resolve({}) };

function authedRequest(correlationId?: string) {
  // x-org-id + session.user.id を揃えると requireAuthContext が membership だけで成功する
  return new NextRequest('http://localhost/api/x', {
    headers: {
      'x-org-id': 'org_1',
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('withAuthContext error envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    resolveLocalUserByIdentityMock.mockResolvedValue(null);
  });

  it('preserves the handler response while enforcing sensitive no-store headers', async () => {
    const handler = vi.fn().mockResolvedValue(
      NextResponse.json(
        { ok: true },
        {
          status: 200,
          headers: { 'Cache-Control': 'public, max-age=3600', 'X-Handler': 'preserved' },
        },
      ),
    );
    const res = await withAuthContext(handler)(authedRequest('workflow_123'), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('X-Handler')).toBe('preserved');
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('X-Correlation-Id')).toBe('workflow_123');
    expect(handler).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        requestId: res.headers.get('X-Request-Id'),
        correlationId: 'workflow_123',
      }),
      routeContext,
    );
    expectSensitiveNoStore(res);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('supports a plain Response while preserving safe streaming cache directives', async () => {
    const handlerResponse = new Response('stream', {
      headers: {
        'Cache-Control': 'public, max-age=3600, no-cache, no-transform',
        'Content-Type': 'text/event-stream',
      },
    });
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const res = await withAuthContext(handler)(authedRequest(), routeContext);

    expect(res).toBe(handlerResponse);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, no-cache, no-transform',
    );
    expect(res.headers.get('Cache-Control')).not.toContain('public');
    expect(res.headers.get('Pragma')).toBe('no-cache');
  });

  it('converts an unexpected handler throw into the standard 500 {code,message} envelope', async () => {
    const rawError = new Error('boom: patient=青葉 花子 insurance=MED-SECRET-1');
    const handler = vi.fn().mockRejectedValue(rawError);
    const res = await withAuthContext(handler)(authedRequest(), routeContext);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(typeof body.message).toBe('string');
    // 生のエラーメッセージ(内部情報)を漏らさない
    expect(body.message).not.toContain('青葉');
    expect(body.message).not.toContain('MED-SECRET-1');
    expectSensitiveNoStore(res);
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/x',
        method: 'GET',
        requestId: expect.any(String),
        correlationId: expect.any(String),
      }),
      rawError,
    );
    const [logContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(typeof logContext).not.toBe('string');
    expect(JSON.stringify(logContext)).not.toContain('青葉');
    expect(JSON.stringify(logContext)).not.toContain('MED-SECRET-1');
  });

  it('converts an unexpected authentication throw into a traced no-store 500', async () => {
    const rawError = new Error('identity provider failed for patient=青葉 花子');
    authMock.mockRejectedValueOnce(rawError);
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const response = await withAuthContext(handler)(
      authedRequest('auth_failure_workflow_1'),
      routeContext,
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('X-Correlation-Id')).toBe('auth_failure_workflow_1');
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_auth_unhandled_error',
        route: '/api/x',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: 'auth_failure_workflow_1',
      }),
      rawError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('青葉');
  });

  it('re-throws Next.js redirect/notFound control-flow errors instead of swallowing them', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    const handler = vi.fn().mockRejectedValue(redirectError);
    await expect(withAuthContext(handler)(authedRequest(), routeContext)).rejects.toBe(
      redirectError,
    );
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('does not assign an unverified requested org to the tenant audit log', async () => {
    membershipFindFirstMock.mockResolvedValue(null);
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const request = new NextRequest('http://localhost/api/x', {
      headers: { 'x-org-id': 'org_target' },
    });

    const response = await withAuthContext(handler)(request, routeContext);

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(handler).not.toHaveBeenCalled();
    const event = logSecurityEventMock.mock.calls
      .map(([input]) => input as Record<string, unknown>)
      .find((input) => input.event_type === 'unauthorized_access');
    expect(event).toMatchObject({
      event_type: 'unauthorized_access',
      details: { reason: 'no_membership' },
    });
    expect(event).not.toHaveProperty('trusted_org_id');
  });

  it('records a requested org switch only after membership makes the org trusted', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', orgId: 'org_primary' } });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const request = new NextRequest('http://localhost/api/x', {
      headers: { 'x-org-id': 'org_target' },
    });

    const response = await withAuthContext(handler)(request, routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'org_switch',
        trusted_org_id: 'org_target',
        details: { reason: 'org_switch' },
      }),
    );
  });

  it('protects authentication failures for direct requireAuthContext callers', async () => {
    authMock.mockResolvedValue(null);

    const result = await requireAuthContext(
      new NextRequest('http://localhost/api/x', {
        headers: { 'x-org-id': 'org_1', 'x-correlation-id': 'login_attempt_1' },
      }),
    );

    expect('response' in result).toBe(true);
    if (!('response' in result)) throw new Error('Expected an authentication failure response');
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.response.headers.get('X-Correlation-Id')).toBe('login_attempt_1');
    expectSensitiveNoStore(result.response);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'auth_failure',
        request_id: result.response.headers.get('X-Request-Id'),
        correlation_id: 'login_attempt_1',
        details: { reason: 'no_user_identity' },
      }),
    );
  });
});
