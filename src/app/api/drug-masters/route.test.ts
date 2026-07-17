import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { serverCache } from '@/lib/utils/server-cache';
import { invalidateDrugMasterSearchCache } from '@/server/services/drug-master-search-cache';
import { expectNoStore } from '@/test/api-response-assertions';
import { genericCandidatesResponseSchema } from '@/app/(dashboard)/prescriptions/new/generic-candidate-schema';

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
  runWithRequestAuthContextMock,
  unstableRethrowMock,
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
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    unstableRethrowMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: vi.fn(),
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

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

async function invokeGet(request: NextRequest) {
  return GET(request, { params: Promise.resolve({}) });
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
    drug_price: new Prisma.Decimal('12.30'),
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
    serverCache.clear();
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

    const response = await invokeGet(
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
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
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
      meta: { has_more: false, next_cursor: null, total_count: 1 },
    });
  });

  it('attaches generic price-comparison data for generic candidate searches', async () => {
    const response = await invokeGet(
      createRequest(
        'http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0%E3%83%AD&generic=true&limit=5&includeTotal=false',
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
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: [
        expect.objectContaining({
          drug_name: 'アムロジピンOD錠5mg',
          drug_price: 12.3,
          tall_man_name: 'amLODIPine OD錠5mg',
          is_high_risk: true,
          is_lasa_risk: true,
          generic_price_comparison: expect.objectContaining({
            lowest_price: '10.5',
          }),
        }),
      ],
    });
    expect(genericCandidatesResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('normalizes null and non-finite price values to the consumer number-or-null wire', async () => {
    drugMasterFindManyMock.mockResolvedValueOnce([
      buildDrugMasterHit({ id: 'drug_null', yj_code: 'YJ_NULL', drug_price: null }),
      buildDrugMasterHit({
        id: 'drug_nonfinite',
        yj_code: 'YJ_NONFINITE',
        drug_price: { toNumber: () => Number.POSITIVE_INFINITY },
      }),
    ]);

    const response = await invokeGet(
      createRequest('http://localhost/api/drug-masters?generic=true&limit=5&includeTotal=false'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      expect.objectContaining({ id: 'drug_null', drug_price: null }),
      expect.objectContaining({ id: 'drug_nonfinite', drug_price: null }),
    ]);
    expect(genericCandidatesResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('supports high-risk and LASA filters for medication-safety review', async () => {
    const response = await invokeGet(
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

  it('preserves category, generic, narcotic, price sort, and maximum limit semantics', async () => {
    const response = await invokeGet(
      createRequest(
        'http://localhost/api/drug-masters?category=21&generic=true&narcotic=true&sort=drug_price&order=desc&limit=100',
      ),
    );

    expect(response.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          therapeutic_category: { startsWith: '21' },
          is_generic: true,
          is_narcotic: true,
        }),
        orderBy: [{ drug_price: 'desc' }, { drug_name: 'asc' }],
        skip: 0,
        take: 101,
      }),
    );
  });

  it.each(['0', '101'])('rejects out-of-range limit %s before RLS', async (limit) => {
    const response = await invokeGet(
      createRequest(`http://localhost/api/drug-masters?limit=${limit}`),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects invalid boolean filters before RLS', async () => {
    const response = await invokeGet(createRequest('http://localhost/api/drug-masters?generic=1'));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns site-scoped 404 before global master reads for another organization site', async () => {
    pharmacySiteFindFirstMock.mockResolvedValueOnce(null);

    const response = await invokeGet(
      createRequest('http://localhost/api/drug-masters?site_id=other_site&limit=5'),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'other_site', org_id: 'org_1' },
      select: { id: true },
    });
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(genericDrugMappingFindManyMock).not.toHaveBeenCalled();
    expect(pharmacyDrugStockFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed limit values before site or drug lookup', async () => {
    const response = await invokeGet(
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
    const response = await invokeGet(
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
    const response = await invokeGet(
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

    const response = await invokeGet(
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
      meta: { has_more: true, next_cursor: '1' },
    });
    expect(payload.meta).not.toHaveProperty('total_count');
  });

  it('caches the org-independent search result across repeated identical queries', async () => {
    const cacheSetSpy = vi.spyOn(serverCache, 'set');
    const first = await invokeGet(
      createRequest('http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0&limit=5'),
    );
    if (!first) throw new Error('response is required');
    expect(first.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(1);
    expect(drugMasterCountMock).toHaveBeenCalledTimes(1);
    expect(genericDrugMappingFindManyMock).toHaveBeenCalledTimes(1);
    expect(cacheSetSpy).toHaveBeenCalledOnce();
    expect(cacheSetSpy.mock.calls[0]?.[2]).toBe(120_000);

    const second = await invokeGet(
      createRequest('http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0&limit=5'),
    );
    if (!second) throw new Error('response is required');
    expect(second.status).toBe(200);
    // 2回目は DB を再度叩かずキャッシュから返す（DrugMaster はグローバルマスタ）。
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(1);
    expect(drugMasterCountMock).toHaveBeenCalledTimes(1);
    expect(genericDrugMappingFindManyMock).toHaveBeenCalledTimes(1);

    const firstPayload = await first.json();
    const secondPayload = await second.json();
    expect(firstPayload.data[0]?.drug_price).toBe(12.3);
    expect(secondPayload).toEqual(firstPayload);
  });

  it('bypasses the cache for org-scoped stocked-only searches', async () => {
    pharmacyDrugStockFindManyMock.mockResolvedValue([]);

    await invokeGet(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&stocked=true&limit=5'),
    );
    await invokeGet(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&stocked=true&limit=5'),
    );

    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(2);
    expect(drugMasterCountMock).toHaveBeenCalledTimes(2);
  });

  it('reuses only global search data while refreshing site stock on every site-only request', async () => {
    pharmacyDrugStockFindManyMock
      .mockResolvedValueOnce([{ id: 'stock_first', drug_master_id: 'drug_1' }])
      .mockResolvedValueOnce([{ id: 'stock_second', drug_master_id: 'drug_1' }]);

    const first = await invokeGet(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&limit=5'),
    );
    const second = await invokeGet(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&limit=5'),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledTimes(2);
    expect(drugMasterFindManyMock).toHaveBeenCalledOnce();
    expect(genericDrugMappingFindManyMock).toHaveBeenCalledOnce();
    expect(pharmacyDrugStockFindManyMock).toHaveBeenCalledTimes(2);
    await expect(first.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({ stock_config: expect.objectContaining({ id: 'stock_first' }) }),
      ],
    });
    await expect(second.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({ stock_config: expect.objectContaining({ id: 'stock_second' }) }),
      ],
    });
  });

  it('invalidates the search cache after a drug-master import completes', async () => {
    const first = await invokeGet(
      createRequest('http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0&limit=5'),
    );
    if (!first) throw new Error('response is required');
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(1);

    invalidateDrugMasterSearchCache();

    const second = await invokeGet(
      createRequest('http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0&limit=5'),
    );
    if (!second) throw new Error('response is required');
    // 取込完了後はキャッシュが無効化され、再度 DB を読む。
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(2);
  });

  it('returns no-store 401 before drug lookups when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);
    const cacheGetSpy = vi.spyOn(serverCache, 'get');

    const response = await invokeGet(
      createRequest('http://localhost/api/drug-masters?limit=invalid'),
    );

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('preserves collection search for a non-admin active member', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk', site_id: null });

    const response = await invokeGet(createRequest('http://localhost/api/drug-masters?limit=5'));

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
  });

  it('returns a traced safe 500 before RLS or cache when auth dependencies fail', async () => {
    const unsafeError = new Error('raw drug master auth secret');
    unsafeError.name = 'DrugMasterListAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);
    const cacheGetSpy = vi.spyOn(serverCache, 'get');

    const response = await invokeGet(
      createRequest('http://localhost/api/drug-masters?limit=invalid'),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /drug master auth secret|DrugMasterListAuthSecretError/,
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-masters',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
  });

  it('returns a sanitized no-store 500 when list lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw drug master list secret');
    unsafeError.name = 'DrugMasterListSecretError';
    drugMasterFindManyMock.mockRejectedValueOnce(unsafeError);
    const cacheSetSpy = vi.spyOn(serverCache, 'set');

    const response = await invokeGet(createRequest('http://localhost/api/drug-masters?limit=5'));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('list secret');
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('list secret');
    expect(logged).not.toContain('DrugMasterListSecretError');

    const retry = await invokeGet(createRequest('http://localhost/api/drug-masters?limit=5'));
    expect(retry.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(2);
    expect(cacheSetSpy).toHaveBeenCalledOnce();
  });

  it('rethrows auth and handler control flow without logging or caching', async () => {
    const cacheSetSpy = vi.spyOn(serverCache, 'set');
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      invokeGet(createRequest('http://localhost/api/drug-masters?limit=invalid')),
    ).rejects.toBe(authControl);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    withOrgContextMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      invokeGet(createRequest('http://localhost/api/drug-masters?limit=5')),
    ).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
