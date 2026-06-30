import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  serviceAreaFindManyMock,
  serviceAreaCountMock,
  serviceAreaCreateMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  serviceAreaFindManyMock: vi.fn(),
  serviceAreaCountMock: vi.fn(),
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

function createGetRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/service-areas', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/service-areas', {
    method: 'POST',
    body: '{bad json',
    headers: { 'content-type': 'application/json' },
  });
}

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
    serviceAreaCountMock.mockResolvedValue(1);
    serviceAreaCreateMock.mockResolvedValue({ id: 'area_2' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        serviceArea: {
          findMany: serviceAreaFindManyMock,
          count: serviceAreaCountMock,
          create: serviceAreaCreateMock,
        },
      }),
    );
  });

  it('lists service areas', async () => {
    const response = (await GET(createGetRequest('http://localhost/api/service-areas')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'area_1' }],
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'service_areas',
      filters_applied: { site_id: null },
      limit: 100,
    });
    expect(serviceAreaCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
    });
    expect(serviceAreaFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
      orderBy: [{ site_id: 'asc' }, { name: 'asc' }],
      take: 100,
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  });

  it('bounds service area list size and trims site filters', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/service-areas?site_id=%20site_1%20&limit=5'),
    ))!;

    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(serviceAreaCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
      },
    });
    expect(serviceAreaFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          site_id: 'site_1',
        },
        take: 5,
      }),
    );
  });

  it('returns counted metadata when the bounded list is truncated', async () => {
    serviceAreaCountMock.mockResolvedValueOnce(205);
    serviceAreaFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 200 }, (_value, index) => ({ id: `area_${index + 1}` })),
    );

    const response = (await GET(
      createGetRequest('http://localhost/api/service-areas?limit=9999'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total_count: 205,
      visible_count: 200,
      hidden_count: 5,
      truncated: true,
      count_basis: 'service_areas',
      filters_applied: { site_id: null },
      limit: 200,
    });
  });

  it('clamps overly large service area list limits', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/service-areas?limit=9999'),
    ))!;

    expect(response.status).toBe(200);
    expect(serviceAreaFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('rejects blank site filters before reference checks or DB access', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/service-areas?site_id=%20%20'),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(serviceAreaFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects site filters outside the authenticated org', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
        { status: 400 },
      ),
    });

    const response = (await GET(
      createGetRequest('http://localhost/api/service-areas?site_id=site_other_org'),
    ))!;

    expect(response.status).toBe(400);
    expect(serviceAreaFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a service area', async () => {
    const response = (await POST(
      createPostRequest({
        site_id: 'site_1',
        name: '北多摩',
        area_type: 'radius',
        geo_data: { match_keywords: ['多摩'] },
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(serviceAreaCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        site_id: 'site_1',
        name: '北多摩',
        area_type: 'radius',
        geo_data: { match_keywords: ['多摩'] },
      }),
      include: expect.any(Object),
    });
  });

  it('rejects non-object create payloads before validating references', async () => {
    const response = (await POST(createPostRequest([])))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(serviceAreaCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before validating references', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(serviceAreaCreateMock).not.toHaveBeenCalled();
  });

  it('rejects creating a service area with a site outside the authenticated org', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' },
        { status: 400 },
      ),
    });

    const response = (await POST(
      createPostRequest({
        site_id: 'site_other_org',
        name: '北多摩',
        area_type: 'radius',
        geo_data: {},
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(serviceAreaCreateMock).not.toHaveBeenCalled();
  });
});
