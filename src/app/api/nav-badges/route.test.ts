import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { authMode, withAuthMock, buildNavBadgePayloadMock } = vi.hoisted(() => ({
  authMode: {
    value: 'success' as 'success' | 'response' | 'throw',
  },
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) => {
        if (authMode.value === 'response') {
          return Promise.resolve(
            new Response(
              JSON.stringify({ code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        if (authMode.value === 'throw') {
          return Promise.reject(new Error('patient:山田太郎 medication:ワルファリン'));
        }
        return handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        });
      };
    },
  ),
  buildNavBadgePayloadMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthMock,
}));

vi.mock('@/server/services/nav-badges', () => ({
  buildNavBadgePayload: buildNavBadgePayloadMock,
}));

import { GET as rawGET } from './route';

const routeContext = { params: Promise.resolve({}) };

describe('/api/nav-badges GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'success';
    buildNavBadgePayloadMock.mockResolvedValue({ audit: 2, handoff: 3 });
  });

  it('returns the aggregated sidebar badge counts for the authenticated org context', async () => {
    const response = await rawGET(new NextRequest('http://localhost/api/nav-badges'), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: { audit: 2, handoff: 3 } });
    expect(buildNavBadgePayloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
    });
  });

  it('preserves auth rejection bodies while applying sensitive no-store headers', async () => {
    authMode.value = 'response';

    const response = await rawGET(new NextRequest('http://localhost/api/nav-badges'), routeContext);

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_UNAUTHENTICATED',
      message: '認証が必要です',
    });
    expect(buildNavBadgePayloadMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing throws unexpectedly', async () => {
    authMode.value = 'throw';

    const response = await rawGET(new NextRequest('http://localhost/api/nav-badges'), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(buildNavBadgePayloadMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when badge aggregation throws unexpectedly', async () => {
    buildNavBadgePayloadMock.mockRejectedValueOnce(
      new Error('patient:山田太郎 medication:ワルファリン'),
    );

    const response = await rawGET(new NextRequest('http://localhost/api/nav-badges'), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
  });
});
