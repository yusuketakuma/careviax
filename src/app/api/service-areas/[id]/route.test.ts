import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  validateOrgReferencesMock,
  serviceAreaFindFirstMock,
  serviceAreaUpdateMock,
  serviceAreaDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  serviceAreaFindFirstMock: vi.fn(),
  serviceAreaUpdateMock: vi.fn(),
  serviceAreaDeleteMock: vi.fn(),
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
  if (body === undefined) {
    return new NextRequest(url, { method: 'DELETE' });
  }
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPatchRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    body: '{bad json',
    headers: { 'content-type': 'application/json' },
  });
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
};

describe('/api/service-areas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    serviceAreaFindFirstMock.mockResolvedValue({ id: 'area_1' });
    serviceAreaUpdateMock.mockResolvedValue({ id: 'area_1', name: 'エリアA' });
    serviceAreaDeleteMock.mockResolvedValue({});
  });

  describe('PATCH', () => {
    it('returns 200 on valid update', async () => {
      const updated = { id: 'area_1', name: 'エリアA' };
      serviceAreaUpdateMock.mockResolvedValueOnce(updated);
      // First call: findFirst (existing check), second call: update
      withOrgContextMock
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { findFirst: serviceAreaFindFirstMock } }),
        )
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { update: serviceAreaUpdateMock } }),
        );

      const req = createRequest('http://localhost/api/service-areas/area_1', {
        name: 'エリアA',
        geo_data: { match_keywords: ['多摩'] },
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'area_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.name).toBe('エリアA');
      expect(serviceAreaUpdateMock).toHaveBeenCalledWith({
        where: { id: 'area_1' },
        data: {
          name: 'エリアA',
          geo_data: { match_keywords: ['多摩'] },
        },
      });
    });

    it('returns 404 when area not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );

      const req = createRequest('http://localhost/api/service-areas/missing', {
        name: 'Test',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });

    it('rejects non-object update payloads before reference validation or lookup', async () => {
      const req = createRequest('http://localhost/api/service-areas/area_1', []);
      const res = await PATCH(req, { params: Promise.resolve({ id: 'area_1' }) });

      expect(res!.status).toBe(400);
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(serviceAreaUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON update payloads before reference validation or lookup', async () => {
      const req = createMalformedJsonPatchRequest('http://localhost/api/service-areas/area_1');
      const res = await PATCH(req, { params: Promise.resolve({ id: 'area_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(serviceAreaUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects blank route ids before reference validation or lookup', async () => {
      const req = createRequest('http://localhost/api/service-areas/%20%20%20', {
        site_id: 'site_1',
        name: 'エリアA',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: '訪問エリアIDが不正です',
      });
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(serviceAreaUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects updates when the replacement site is outside the authenticated org', async () => {
      validateOrgReferencesMock.mockResolvedValueOnce({
        ok: false,
        response: Response.json(
          { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
          { status: 400 },
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
          fn({ serviceArea: { findFirst: serviceAreaFindFirstMock } }),
        )
        .mockImplementationOnce(async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({ serviceArea: { delete: serviceAreaDeleteMock } }),
        );

      const req = createRequest('http://localhost/api/service-areas/area_1');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'area_1' }) });
      expect(res!.status).toBe(200);
    });

    it('rejects blank route ids before loading the service area', async () => {
      const req = createRequest('http://localhost/api/service-areas/%20%20%20');
      const res = await DELETE(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: '訪問エリアIDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(serviceAreaDeleteMock).not.toHaveBeenCalled();
    });

    it('returns 404 when area not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ serviceArea: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );

      const req = createRequest('http://localhost/api/service-areas/missing');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });
  });
});
