import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, loggerErrorMock } = vi.hoisted(() => {
  const prismaMock = {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn(), findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
  };

  return {
    authMock: vi.fn(),
    prismaMock,
    withOrgContextMock: vi.fn((_orgId, fn) =>
      fn({
        pharmacySite: prismaMock.pharmacySite,
        drugMaster: prismaMock.drugMaster,
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

describe('/api/drug-masters/[id]/ingredient-group', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        drug_master_id: 'generic_1',
        is_stocked: true,
        preferred_generic_id: null,
        reorder_point: 10,
        follow_up_status: null,
      },
    ]);
  });

  it('groups same-generic-name members with site formulary status and price summary', async () => {
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
        id: 'brand_1',
        yj_code: '123456789012',
        drug_name: 'ノルバスク錠5mg',
        generic_name: 'アムロジピンベシル酸塩',
        drug_price: 20,
        unit: '錠',
        manufacturer: '先発製薬',
        is_generic: false,
        transitional_expiry_date: null,
      },
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
        'http://localhost/api/drug-masters/brand_1/ingredient-group?site_id=site_1&limit=%202%20',
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
      generic_name: 'アムロジピンベシル酸塩',
      summary: {
        member_count: 2,
        brand_count: 1,
        generic_count: 1,
        stocked_count: 1,
        unstocked_count: 1,
        lowest_price: 10,
        highest_price: 20,
      },
      members: [
        { id: 'brand_1', site_stock: null },
        { id: 'generic_1', site_stock: { is_stocked: true, reorder_point: 10 } },
      ],
    });
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: { in: ['brand_1', 'generic_1'] },
        },
      }),
    );
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
  });

  it('returns an empty group reason when generic_name is missing', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'drug_1',
      yj_code: '123456789012',
      drug_name: '一般名未設定薬',
      generic_name: null,
      drug_price: null,
      unit: null,
      is_generic: false,
    });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/drug_1/ingredient-group?site_id=site_1'),
      { params: Promise.resolve({ id: 'drug_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      generic_name: null,
      summary: null,
      members: [],
      reason: 'generic_name_missing',
    });
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('rejects another org site before loading the target group', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group?site_id=site_2'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed limit values before site or target lookup', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters/brand_1/ingredient-group?site_id=site_1&limit=2abc',
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
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before group reads when admin permission is denied', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({ role: 'viewer' });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group?site_id=site_1'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when ingredient group lookup fails unexpectedly', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'brand_1',
      yj_code: '123456789012',
      drug_name: 'ノルバスク錠5mg',
      generic_name: 'アムロジピンベシル酸塩',
      drug_price: 20,
      unit: '錠',
      is_generic: false,
    });
    const unsafeError = new Error('raw ingredient group secret');
    unsafeError.name = 'IngredientGroupSecretError';
    prismaMock.drugMaster.findMany.mockRejectedValueOnce(unsafeError);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('ingredient group secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_masters_ingredient_group_get_unhandled_error',
      undefined,
      {
        event: 'drug_masters_ingredient_group_get_unhandled_error',
        route: '/api/drug-masters/[id]/ingredient-group',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('ingredient group secret');
    expect(logged).not.toContain('IngredientGroupSecretError');
  });
});
