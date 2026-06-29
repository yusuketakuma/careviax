import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, loggerErrorMock } = vi.hoisted(() => {
  const prismaMock = {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn(), findMany: vi.fn() },
    genericDrugMapping: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
  };

  return {
    authMock: vi.fn(),
    prismaMock,
    withOrgContextMock: vi.fn((_orgId, fn) =>
      fn({
        pharmacySite: prismaMock.pharmacySite,
        drugMaster: prismaMock.drugMaster,
        genericDrugMapping: prismaMock.genericDrugMapping,
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
      }),
    ),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-masters/[id]/generic-recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.genericDrugMapping.findFirst.mockResolvedValue({
      price_comparison: { lowest_price: '10.50' },
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        drug_master_id: 'generic_1',
        is_stocked: true,
        preferred_generic_id: null,
        reorder_point: 10,
      },
    ]);
  });

  it('returns lower-price generic recommendations with site stock status', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'brand_1',
      yj_code: '123456789012',
      drug_name: 'ノルバスク錠5mg',
      generic_name: 'アムロジピンベシル酸塩',
      drug_price: 20,
      unit: '錠',
      is_generic: false,
    });
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'generic_1',
        yj_code: '123456789099',
        drug_name: 'アムロジピン錠5mg「GE」',
        generic_name: 'アムロジピンベシル酸塩',
        drug_price: 10,
        unit: '錠',
        manufacturer: 'GE製薬',
        is_generic: true,
        transitional_expiry_date: null,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters/brand_1/generic-recommendations?site_id=site_1&limit=%205%20',
      ),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
          role: 'admin',
        }),
        maxWaitMs: 10_000,
        timeoutMs: 20_000,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      recommendations: [
        {
          id: 'generic_1',
          price_delta: -10,
          price_delta_percent: -50,
          site_stock: {
            is_stocked: true,
            reorder_point: 10,
          },
        },
      ],
    });
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generic_name: 'アムロジピンベシル酸塩',
          is_generic: true,
          id: { not: 'brand_1' },
        }),
        orderBy: [{ drug_price: 'asc' }, { drug_name_kana: 'asc' }, { drug_name: 'asc' }],
        take: 5,
      }),
    );
  });

  it('rejects malformed limit values before site or target lookup', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters/brand_1/generic-recommendations?site_id=site_1&limit=10.0',
      ),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.genericDrugMapping.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before recommendation reads when admin permission is denied', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({ role: 'viewer' });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when recommendation lookup fails unexpectedly', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'brand_1',
      yj_code: '123456789012',
      drug_name: 'ノルバスク錠5mg',
      generic_name: 'アムロジピンベシル酸塩',
      drug_price: 20,
      unit: '錠',
      is_generic: false,
    });
    const unsafeError = new Error('raw generic recommendation secret');
    unsafeError.name = 'GenericRecommendationSecretError';
    prismaMock.drugMaster.findMany.mockRejectedValueOnce(unsafeError);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('recommendation secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_masters_generic_recommendations_get_unhandled_error',
      undefined,
      {
        event: 'drug_masters_generic_recommendations_get_unhandled_error',
        route: '/api/drug-masters/[id]/generic-recommendations',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('recommendation secret');
    expect(logged).not.toContain('GenericRecommendationSecretError');
  });
});
