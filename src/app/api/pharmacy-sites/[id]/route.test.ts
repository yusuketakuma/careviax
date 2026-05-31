import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySite: { findFirst: pharmacySiteFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url);
  }
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createInvalidJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin', ipAddress: '127.0.0.1', userAgent: 'test' },
};

describe('/api/pharmacy-sites/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  describe('GET', () => {
    it('returns 200 with pharmacy site data', async () => {
      const site = { id: 'site_1', name: '薬局A', insurance_configs: [] };
      pharmacySiteFindFirstMock.mockResolvedValue(site);

      const req = createRequest('http://localhost/api/pharmacy-sites/site_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'site_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.id).toBe('site_1');
    });

    it('returns 404 when site not found', async () => {
      pharmacySiteFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/pharmacy-sites/missing');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });
  });

  describe('PATCH', () => {
    it('returns 200 on valid update', async () => {
      pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
      const updated = { id: 'site_1', name: '薬局B', address: '東京都' };
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({
          pharmacySite: { update: vi.fn().mockResolvedValue(updated) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        })
      );

      const req = createRequest('http://localhost/api/pharmacy-sites/site_1', {
        name: '薬局B',
        address: '東京都',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.name).toBe('薬局B');
    });

    it('returns 400 on invalid body', async () => {
      const req = createInvalidJsonRequest('http://localhost/api/pharmacy-sites/site_1');
      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });
      expect(res!.status).toBe(400);
    });
  });
});
