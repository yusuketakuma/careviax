import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, pushSubscriptionUpsertMock, pushSubscriptionDeleteManyMock } =
  vi.hoisted(() => ({
    requireAuthContextMock: vi.fn(),
    pushSubscriptionUpsertMock: vi.fn(),
    pushSubscriptionDeleteManyMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pushSubscription: {
      upsert: pushSubscriptionUpsertMock,
      deleteMany: pushSubscriptionDeleteManyMock,
    },
  },
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

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/push-subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  describe('POST', () => {
    it('returns 200 on valid subscription', async () => {
      pushSubscriptionUpsertMock.mockResolvedValue({});

      const req = createJsonRequest('POST', {
        endpoint: ' https://push.example.com/sub/abc ',
        keys: { p256dh: ' key1 ', auth: ' key2 ' },
      });
      const res = await POST(req);
      expect(res!.status).toBe(200);
      expect(pushSubscriptionUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://push.example.com/sub/abc' },
          create: expect.objectContaining({
            endpoint: 'https://push.example.com/sub/abc',
            p256dh: 'key1',
            auth: 'key2',
          }),
          update: expect.objectContaining({
            p256dh: 'key1',
            auth: 'key2',
          }),
        }),
      );
    });

    it('returns 400 on invalid body', async () => {
      const req = createJsonRequest('POST', {
        endpoint: 'not-a-url',
      });
      const res = await POST(req);
      expect(res!.status).toBe(400);
    });

    it('rejects non-object subscription payloads before upsert', async () => {
      const req = createJsonRequest('POST', []);
      const res = await POST(req);

      expect(res!.status).toBe(400);
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON subscription payloads before upsert', async () => {
      const req = createMalformedJsonRequest('POST');
      const res = await POST(req);

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(pushSubscriptionUpsertMock).not.toHaveBeenCalled();
    });

    it('rejects non-HTTPS endpoints and blank keys before upsert', async () => {
      const req = createJsonRequest('POST', {
        endpoint: 'http://push.example.com/sub/abc',
        keys: { p256dh: '   ', auth: 'key2' },
      });
      const res = await POST(req);

      expect(res!.status).toBe(400);
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
      expect(res!.status).toBe(200);
      expect(pushSubscriptionDeleteManyMock).toHaveBeenCalledWith({
        where: {
          endpoint: 'https://push.example.com/sub/abc',
          org_id: 'org_1',
          user_id: 'user_1',
        },
      });
    });

    it('returns 400 on missing endpoint', async () => {
      const req = createJsonRequest('DELETE', {});
      const res = await DELETE(req);
      expect(res!.status).toBe(400);
    });

    it('rejects non-object unsubscribe payloads before delete', async () => {
      const req = createJsonRequest('DELETE', []);
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON unsubscribe payloads before delete', async () => {
      const req = createMalformedJsonRequest('DELETE');
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });

    it('rejects non-HTTPS unsubscribe endpoints before delete', async () => {
      const req = createJsonRequest('DELETE', {
        endpoint: 'http://push.example.com/sub/abc',
      });
      const res = await DELETE(req);

      expect(res!.status).toBe(400);
      expect(pushSubscriptionDeleteManyMock).not.toHaveBeenCalled();
    });
  });
});
