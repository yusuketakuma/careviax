import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pushSubscriptionUpsertMock,
  pushSubscriptionDeleteManyMock,
} = vi.hoisted(() => ({
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
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'key1', auth: 'key2' },
      });
      const res = await POST(req);
      expect(res!.status).toBe(200);
      expect(pushSubscriptionUpsertMock).toHaveBeenCalled();
    });

    it('returns 400 on invalid body', async () => {
      const req = createJsonRequest('POST', {
        endpoint: 'not-a-url',
      });
      const res = await POST(req);
      expect(res!.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('returns 200 on valid unsubscribe', async () => {
      pushSubscriptionDeleteManyMock.mockResolvedValue({ count: 1 });

      const req = createJsonRequest('DELETE', {
        endpoint: 'https://push.example.com/sub/abc',
      });
      const res = await DELETE(req);
      expect(res!.status).toBe(200);
    });

    it('returns 400 on missing endpoint', async () => {
      const req = createJsonRequest('DELETE', {});
      const res = await DELETE(req);
      expect(res!.status).toBe(400);
    });
  });
});
