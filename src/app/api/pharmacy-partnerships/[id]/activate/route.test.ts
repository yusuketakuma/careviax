import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { handlerMock } = vi.hoisted(() => ({ handlerMock: vi.fn() }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: NextRequest, routeContext?: unknown) => {
      handlerMock(req, routeContext);
      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    },
}));

import { POST as rawPOST } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/pharmacy-partnerships/partnership_1/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      base_approved_by: 'caller-controlled-base',
      partner_approved_by: 'caller-controlled-partner',
    }),
  });
}

describe('/api/pharmacy-partnerships/[id]/activate POST', () => {
  it('fails closed before reading approval strings or causing side effects', async () => {
    const response = await rawPOST(createRequest(), {
      params: Promise.resolve({ id: 'partnership_1' }),
    });

    expect(response.status).toBe(501);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'BILLING_PARTNER_APPROVAL_NOT_IMPLEMENTED',
      message: '認証済みの両薬局による個別承認が実装されるまで薬局間連携を有効化できません',
    });
    expect(handlerMock).toHaveBeenCalledOnce();
  });

  it('validates the route id before returning the fail-closed boundary', async () => {
    const response = await rawPOST(createRequest(), { params: Promise.resolve({ id: '   ' }) });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '薬局間連携IDが不正です',
    });
  });
});
