import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindFirstMock,
  pharmacySiteUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  pharmacySiteUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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
  ctx: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

describe('/api/pharmacy-sites/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    pharmacySiteUpdateMock.mockResolvedValue({
      id: 'site_1',
      name: '薬局B',
      address: '東京都',
      phone: '03-1234-5678',
      fax: null,
    });
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        pharmacySite: { update: pharmacySiteUpdateMock },
        auditLog: { create: auditLogCreateMock },
      }),
    );
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

    it('rejects blank route ids before loading the pharmacy site', async () => {
      const req = createRequest('http://localhost/api/pharmacy-sites/%20%20%20');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: '薬局IDが不正です',
      });
      expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('rejects non-object update payloads before loading the pharmacy site', async () => {
      const req = createRequest('http://localhost/api/pharmacy-sites/site_1', []);
      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects blank route ids before loading the pharmacy site for update', async () => {
      const req = createRequest('http://localhost/api/pharmacy-sites/%20%20%20', {
        name: '薬局B',
        address: '東京都',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: '薬局IDが不正です',
      });
      expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pharmacySiteUpdateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });

    it('returns 200 on valid update', async () => {
      pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });

      const req = createRequest('http://localhost/api/pharmacy-sites/site_1', {
        name: ' 薬局B ',
        address: ' 東京都 ',
        phone: ' 03-1234-5678 ',
        fax: '   ',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });
      expect(res!.status).toBe(200);
      expect(pharmacySiteUpdateMock).toHaveBeenCalledWith({
        where: { id: 'site_1' },
        data: {
          name: '薬局B',
          address: '東京都',
          phone: '03-1234-5678',
          fax: null,
          is_health_support_pharmacy: false,
          is_regional_support: false,
          is_specialized_pharmacy: false,
          dispensing_fee_category: null,
        },
      });
      expect(auditLogCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'pharmacy_site_updated',
            changes: expect.objectContaining({
              name: '薬局B',
              address: '東京都',
              phone: '03-1234-5678',
              fax: null,
            }),
          }),
        }),
      );
      const json = await res!.json();
      expect(json.data.name).toBe('薬局B');
    });

    it('rejects malformed phone and fax before loading the pharmacy site', async () => {
      const req = createRequest('http://localhost/api/pharmacy-sites/site_1', {
        name: '薬局B',
        address: '東京都',
        phone: '03-ABCD-5678',
        fax: 'FAX-9999',
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        details: {
          phone: ['電話番号形式が不正です'],
          fax: ['FAX番号形式が不正です'],
        },
      });
      expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pharmacySiteUpdateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON update payloads before loading the pharmacy site', async () => {
      const req = createInvalidJsonRequest('http://localhost/api/pharmacy-sites/site_1');
      const res = await PATCH(req, { params: Promise.resolve({ id: 'site_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pharmacySiteUpdateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });
  });
});
