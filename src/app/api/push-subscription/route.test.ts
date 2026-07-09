import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  pushSubscriptionUpsertMock,
  pushSubscriptionDeleteManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pushSubscriptionUpsertMock: vi.fn(),
  pushSubscriptionDeleteManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST, DELETE } from './route';

function createJsonRequest(method: 'POST' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost/api/push-subscription', {
    method,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest(method: 'POST' | 'DELETE') {
  return new NextRequest('http://localhost/api/push-subscription', {
    method,
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

async function expectMinimalSuccessEnvelope(response: Response, forbiddenValues: string[] = []) {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ data: { ok: true } });
  expect(body).not.toHaveProperty('ok');

  const serialized = JSON.stringify(body);
  for (const key of ['endpoint', 'p256dh', 'auth', 'org_id', 'user_id']) {
    expect(serialized).not.toContain(key);
  }
  for (const value of forbiddenValues) {
    expect(serialized).not.toContain(value);
  }
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/push-subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, callback: (tx: unknown) => unknown) =>
        callback({
          pushSubscription: {
            upsert: pushSubscriptionUpsertMock,
            deleteMany: pushSubscriptionDeleteManyMock,
          },
        }),
    );
  });

  it.each(['POST', 'DELETE'] as const)(
    'returns the authorization response before reading a %s payload',
    async (method) => {
      const deniedResponse = new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }),
        { status: 403 },
      );
      requireAuthContextMock.mockResolvedValueOnce({ response: deniedResponse });

      const request = createJsonRequest(
        method,
        method === 'POST'
          ? {
              endpoint: 'https://push.example.com/sub/abc',
              keys: { p256dh: 'key1', auth: 'key2' },
            }
          : { endpoint: 'https://push.example.com/sub/abc' },
      );
      const response = method === 'POST' ? await POST(request) : await DELETE(request);

      expect(response).toBe(deniedResponse);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    },
  );

  describe('POST', () => {
    it('returns 200 on valid subscription', async () => {
      pushSubscriptionUpsertMock.mockResolvedValue({});

      const req = createJsonRequest('POST', {
        endpoint: ' https://push.example.com/sub/abc ',
        keys: { p256dh: ' key1 ', auth: ' key2 ' },
      });
      const res = await POST(req);
      await expectMinimalSuccessEnvelope(res!, [
        'https://push.example.com/sub/abc',
        'key1',
        'key2',
      ]);
      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
        requestContext: authCtx.ctx,
      });
      expect(pushSubscriptionUpsertMock).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example.com/sub/abc' },
        create: {
          org_id: 'org_1',
          user_id: 'user_1',
          endpoint: 'https://push.example.com/sub/abc',
          p256dh: 'key1',
          auth: 'key2',
        },
        update: {
          org_id: 'org_1',
          user_id: 'user_1',
          p256dh: 'key1',
          auth: 'key2',
        },
      });
    });

    it('returns 400 on invalid body', async () => {
      const req = createJsonRequest('POST', {
        endpoint: 'not-a-url',
      });
      const res = await POST(req);
      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });

    it('rejects non-object subscription payloads before upsert', async () => {
      const req = createJsonRequest('POST', []);
      const res = await POST(req);

      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON subscription payloads before upsert', async () => {
      const req = createMalformedJsonRequest('POST');
      const res = await POST(req);

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });

    it('rejects non-HTTPS endpoints and blank keys before upsert', async () => {
      const req = createJsonRequest('POST', {
        endpoint: 'http://push.example.com/sub/abc',
        keys: { p256dh: '   ', auth: 'key2' },
      });
      const res = await POST(req);

      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it('returns 200 on valid unsubscribe', async () => {
      pushSubscriptionDeleteManyMock.mockResolvedValue({ count: 1 });

      const req = createJsonRequest('DELETE', {
        endpoint: ' https://push.example.com/sub/abc ',
      });
      const res = await DELETE(req);
      await expectMinimalSuccessEnvelope(res!, ['https://push.example.com/sub/abc']);
      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
        requestContext: authCtx.ctx,
      });
      expect(pushSubscriptionDeleteManyMock).toHaveBeenCalledWith({
        where: {
          endpoint: 'https://push.example.com/sub/abc',
          org_id: 'org_1',
          user_id: 'user_1',
        },
      });
    });

    it('returns the same success envelope when the subscription is already absent', async () => {
      pushSubscriptionDeleteManyMock.mockResolvedValue({ count: 0 });

      const response = await DELETE(
        createJsonRequest('DELETE', { endpoint: 'https://push.example.com/sub/missing' }),
      );

      await expectMinimalSuccessEnvelope(response!, ['https://push.example.com/sub/missing']);
      expect(pushSubscriptionDeleteManyMock).toHaveBeenCalledWith({
        where: {
          endpoint: 'https://push.example.com/sub/missing',
          org_id: 'org_1',
          user_id: 'user_1',
        },
      });
    });

    it('returns 400 on missing endpoint', async () => {
      const req = createJsonRequest('DELETE', {});
      const res = await DELETE(req);
      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });

    it('rejects non-object unsubscribe payloads before delete', async () => {
      const req = createJsonRequest('DELETE', []);
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON unsubscribe payloads before delete', async () => {
      const req = createMalformedJsonRequest('DELETE');
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });

    it('rejects non-HTTPS unsubscribe endpoints before delete', async () => {
      const req = createJsonRequest('DELETE', {
        endpoint: 'http://push.example.com/sub/abc',
      });
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });
  });
});
