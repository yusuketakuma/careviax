import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { authMock, membershipFindFirstMock, userFindUniqueMock, loggerErrorMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }),
);

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

import { withAuthContext } from './context';

const routeContext = { params: Promise.resolve({}) };

function authedRequest() {
  // x-org-id + session.user.id を揃えると requireAuthContext が membership だけで成功する
  return new NextRequest('http://localhost/api/x', { headers: { 'x-org-id': 'org_1' } });
}

describe('withAuthContext error envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
  });

  it('passes through a NextResponse returned by the handler unchanged', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const res = await withAuthContext(handler)(authedRequest(), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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
});
