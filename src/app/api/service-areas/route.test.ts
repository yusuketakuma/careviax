import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  serviceAreaFindManyMock,
  serviceAreaCreateMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  serviceAreaFindManyMock: vi.fn(),
  serviceAreaCreateMock: vi.fn(),
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

import { GET, POST } from './route';

describe('/api/service-areas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    serviceAreaFindManyMock.mockResolvedValue([{ id: 'area_1' }]);
    serviceAreaCreateMock.mockResolvedValue({ id: 'area_2' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        serviceArea: {
          findMany: serviceAreaFindManyMock,
          create: serviceAreaCreateMock,
        },
      }),
    );
  });

  it('lists service areas', async () => {
    const response = (await GET({
      url: 'http://localhost/api/service-areas',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    expect(serviceAreaFindManyMock).toHaveBeenCalled();
  });

  it('rejects site filters outside the authenticated org', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
        { status: 400 }
      ),
    });

    const response = (await GET({
      url: 'http://localhost/api/service-areas?site_id=site_other_org',
    } as NextRequest))!;

    expect(response.status).toBe(400);
    expect(serviceAreaFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a service area', async () => {
    const response = (await POST({
      json: async () => ({
        site_id: 'site_1',
        name: '北多摩',
        area_type: 'radius',
        geo_data: { match_keywords: ['多摩'] },
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(serviceAreaCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        site_id: 'site_1',
        name: '北多摩',
        area_type: 'radius',
      }),
      include: expect.any(Object),
    });
  });

  it('rejects creating a service area with a site outside the authenticated org', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
        { status: 400 }
      ),
    });

    const response = (await POST({
      json: async () => ({
        site_id: 'site_other_org',
        name: '北多摩',
        area_type: 'radius',
        geo_data: {},
      }),
    } as NextRequest))!;

    expect(response.status).toBe(400);
    expect(serviceAreaCreateMock).not.toHaveBeenCalled();
  });
});
