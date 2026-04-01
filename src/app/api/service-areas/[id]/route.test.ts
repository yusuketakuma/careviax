import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

import { PATCH, DELETE } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: { get: () => null },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
};

describe('/api/service-areas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
  });

  describe('PATCH', () => {
    it('returns 200 on valid update', async () => {
      const updated = { id: 'area_1', name: 'エリアA' };
      // First call: findFirst (existing check), second call: update
      withOrgContextMock
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue({ id: 'area_1' }) } })
        )
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { update: vi.fn().mockResolvedValue(updated) } })
        );

      const req = createRequest('http://localhost/api/service-areas/area_1', {
        name: 'エリアA',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'area_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.name).toBe('エリアA');
    });

    it('returns 404 when area not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue(null) } })
      );

      const req = createRequest('http://localhost/api/service-areas/missing', {
        name: 'Test',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });

    it('rejects updates when the replacement site is outside the authenticated org', async () => {
      validateOrgReferencesMock.mockResolvedValueOnce({
        ok: false,
        response: Response.json(
          { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
          { status: 400 }
        ),
      });

      const req = createRequest('http://localhost/api/service-areas/area_1', {
        site_id: 'site_other_org',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'area_1' }) });

      expect(res!.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it('returns 200 on successful delete', async () => {
      withOrgContextMock
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue({ id: 'area_1' }) } })
        )
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { delete: vi.fn().mockResolvedValue({}) } })
        );

      const req = createRequest('http://localhost/api/service-areas/area_1');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'area_1' }) });
      expect(res!.status).toBe(200);
    });

    it('returns 404 when area not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue(null) } })
      );

      const req = createRequest('http://localhost/api/service-areas/missing');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });
  });
});
