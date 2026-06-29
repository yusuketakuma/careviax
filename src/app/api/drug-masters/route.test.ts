import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  drugMasterFindManyMock,
  drugMasterCountMock,
  genericDrugMappingFindManyMock,
  pharmacySiteFindFirstMock,
  pharmacyDrugStockFindManyMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const membershipFindFirstMock = vi.fn();
  const drugMasterFindManyMock = vi.fn();
  const drugMasterCountMock = vi.fn();
  const genericDrugMappingFindManyMock = vi.fn();
  const pharmacySiteFindFirstMock = vi.fn();
  const pharmacyDrugStockFindManyMock = vi.fn();

  return {
    authMock: vi.fn(),
    membershipFindFirstMock,
    withOrgContextMock: vi.fn((_orgId, fn) =>
      fn({
        drugMaster: {
          findMany: drugMasterFindManyMock,
          count: drugMasterCountMock,
        },
        genericDrugMapping: {
          findMany: genericDrugMappingFindManyMock,
        },
        pharmacySite: {
          findFirst: pharmacySiteFindFirstMock,
        },
        pharmacyDrugStock: {
          findMany: pharmacyDrugStockFindManyMock,
        },
      }),
    ),
    drugMasterFindManyMock,
    drugMasterCountMock,
    genericDrugMappingFindManyMock,
    pharmacySiteFindFirstMock,
    pharmacyDrugStockFindManyMock,
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function buildDrugMasterHit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'drug_1',
    yj_code: '123456789012',
    receipt_code: null,
    jan_code: null,
    drug_name: 'アムロジピンOD錠5mg',
    drug_name_kana: 'アムロジピン',
    generic_name: 'アムロジピンベシル酸塩',
    drug_price: 12.3,
    unit: '錠',
    dosage_form: '錠剤',
    therapeutic_category: '2171',
    manufacturer: 'テスト製薬',
    is_generic: true,
    is_narcotic: false,
    is_psychotropic: false,
    is_high_risk: true,
    is_lasa_risk: true,
    tall_man_name: 'amLODIPine OD錠5mg',
    lasa_group_key: 'amlodipine_amiodarone',
    max_administration_days: null,
    ...overrides,
  };
}

describe('/api/drug-masters GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    drugMasterFindManyMock.mockResolvedValue([buildDrugMasterHit()]);
    drugMasterCountMock.mockResolvedValue(1);
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    pharmacyDrugStockFindManyMock.mockResolvedValue([]);
    genericDrugMappingFindManyMock.mockResolvedValue([
      {
        generic_name: 'アムロジピンベシル酸塩',
        price_comparison: {
          lowest_price: '10.5',
          standard_name: 'アムロジピンOD錠5mg',
          dosage_form: '錠剤',
        },
      },
    ]);
  });

  it('attaches site-specific formulary status and supports stocked-only filtering', async () => {
    pharmacyDrugStockFindManyMock.mockResolvedValue([
      {
        id: 'stock_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        stock_qty: null,
        reorder_point: 10,
        preferred_generic_id: null,
        updated_at: new Date('2026-05-27T00:00:00.000Z'),
        preferred_generic: null,
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&stocked=true&limit=5'),
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
          role: 'pharmacist',
        }),
        maxWaitMs: 10_000,
        timeoutMs: 20_000,
      }),
    );
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'site_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
      },
    });
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          drug_stocks: {
            some: {
              org_id: 'org_1',
              site_id: 'site_1',
              is_stocked: true,
            },
          },
        }),
      }),
    );
    expect(pharmacyDrugStockFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: { in: ['drug_1'] },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'drug_1',
          stock_config: expect.objectContaining({
            id: 'stock_1',
            is_stocked: true,
            reorder_point: 10,
          }),
        }),
      ],
    });
  });

  it('attaches generic price-comparison data for generic candidate searches', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0%E3%83%AD&generic=true&limit=5',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(genericDrugMappingFindManyMock).toHaveBeenCalledWith({
      where: {
        generic_name: {
          in: ['アムロジピンベシル酸塩'],
        },
      },
      select: {
        generic_name: true,
        price_comparison: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          drug_name: 'アムロジピンOD錠5mg',
          tall_man_name: 'amLODIPine OD錠5mg',
          is_high_risk: true,
          is_lasa_risk: true,
          generic_price_comparison: expect.objectContaining({
            lowest_price: '10.5',
          }),
        }),
      ],
    });
  });

  it('supports high-risk and LASA filters for medication-safety review', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters?highRisk=true&lasa=true&limit=%205%20'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_high_risk: true,
          is_lasa_risk: true,
        }),
        take: 6,
        select: expect.objectContaining({
          is_high_risk: true,
          is_lasa_risk: true,
          tall_man_name: true,
          lasa_group_key: true,
        }),
      }),
    );
  });

  it('rejects malformed limit values before site or drug lookup', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&limit=1e2'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(drugMasterCountMock).not.toHaveBeenCalled();
    expect(pharmacyDrugStockFindManyMock).not.toHaveBeenCalled();
    expect(genericDrugMappingFindManyMock).not.toHaveBeenCalled();
  });

  it.each(['abc', '-10', '25abc'])('uses a safe offset for malformed cursor %s', async (cursor) => {
    const response = await GET(
      createRequest(`http://localhost/api/drug-masters?cursor=${encodeURIComponent(cursor)}`),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 51,
      }),
    );
  });

  it('searches practical drug identifiers and display aliases', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters?q=1234567&limit=5'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { drug_name: { contains: '1234567', mode: 'insensitive' } },
            { drug_name_kana: { contains: '1234567', mode: 'insensitive' } },
            { generic_name: { contains: '1234567', mode: 'insensitive' } },
            { tall_man_name: { contains: '1234567', mode: 'insensitive' } },
            { manufacturer: { contains: '1234567', mode: 'insensitive' } },
            { yj_code: { startsWith: '1234567' } },
            { receipt_code: { startsWith: '1234567' } },
            { hot_code: { startsWith: '1234567' } },
            { jan_code: { startsWith: '1234567' } },
          ]),
        }),
      }),
    );
  });

  it('skips total counting for lightweight candidate searches', async () => {
    drugMasterFindManyMock.mockResolvedValue([
      buildDrugMasterHit({ id: 'drug_1' }),
      buildDrugMasterHit({ id: 'drug_2', yj_code: '987654321098' }),
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0&limit=1&includeTotal=false',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
    expect(drugMasterCountMock).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: [expect.objectContaining({ id: 'drug_1' })],
      hasMore: true,
      nextCursor: '1',
    });
    expect(payload).not.toHaveProperty('totalCount');
  });

  it('returns no-store 401 before drug lookups when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest('http://localhost/api/drug-masters?limit=5'));

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when list lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw drug master list secret');
    unsafeError.name = 'DrugMasterListSecretError';
    drugMasterFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest('http://localhost/api/drug-masters?limit=5'));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('list secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_masters_list_get_unhandled_error',
      undefined,
      {
        event: 'drug_masters_list_get_unhandled_error',
        route: '/api/drug-masters',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('list secret');
    expect(logged).not.toContain('DrugMasterListSecretError');
  });
});
