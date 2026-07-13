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

function authedRequest() {
  // x-org-id + session.user.id を揃えると requireAuthContext が membership だけで成功する
  return new NextRequest('http://localhost/api/x', { headers: { 'x-org-id': 'org_1' } });
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
    const res = await withAuthContext(handler)(authedRequest(), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('X-Handler')).toBe('preserved');
    expectSensitiveNoStore(res);
    expect(loggerErrorMock).not.toHaveBeenCalled();
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
      {
        event: 'route_handler_unhandled_error',
        route: '/api/x',
        method: 'GET',
      },
      rawError,
    );
    const [logContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(typeof logContext).not.toBe('string');
    expect(JSON.stringify(logContext)).not.toContain('青葉');
    expect(JSON.stringify(logContext)).not.toContain('MED-SECRET-1');
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
      new NextRequest('http://localhost/api/x', { headers: { 'x-org-id': 'org_1' } }),
    );

    expect('response' in result).toBe(true);
    if (!('response' in result)) throw new Error('Expected an authentication failure response');
    expect(result.response.status).toBe(401);
    expectSensitiveNoStore(result.response);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'auth_failure',
        details: { reason: 'no_user_identity' },
      }),
    );
  });
});
