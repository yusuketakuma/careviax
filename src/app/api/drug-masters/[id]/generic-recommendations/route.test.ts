import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  prismaMock,
  withOrgContextMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  securityEventExecuteRawMock,
  unstableRethrowMock,
} = vi.hoisted(() => {
  const auditLogCreateMock = vi.fn();
  const securityEventExecuteRawMock = vi.fn();
  const prismaMock = {
    membership: { findFirst: vi.fn() },
    auditLog: { create: auditLogCreateMock },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn(), findMany: vi.fn() },
    genericDrugMapping: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    $transaction: vi.fn(
      (
        fn: (tx: {
          $executeRaw: typeof securityEventExecuteRawMock;
          auditLog: { create: typeof auditLogCreateMock };
        }) => unknown,
      ) =>
        fn({
          $executeRaw: securityEventExecuteRawMock,
          auditLog: { create: auditLogCreateMock },
        }),
    ),
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
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    securityEventExecuteRawMock,
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
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';
import { genericRecommendationsResponseSchema } from '@/app/(dashboard)/admin/drug-masters/drug-master-content-contracts';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function expectNoRecommendationReads() {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
  expect(prismaMock.genericDrugMapping.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
}

function mockTarget(overrides: Record<string, unknown> = {}) {
  prismaMock.drugMaster.findFirst.mockResolvedValue({
    id: 'brand_1',
    yj_code: '123456789012',
    drug_name: 'ノルバスク錠5mg',
    generic_name: 'アムロジピンベシル酸塩',
    drug_price: 20,
    unit: '錠',
    is_generic: false,
    ...overrides,
  });
}

describe('/api/drug-masters/[id]/generic-recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    securityEventExecuteRawMock.mockResolvedValue(0);
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
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
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
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: {
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
      },
    });
    expect(genericRecommendationsResponseSchema.safeParse(payload).success).toBe(true);
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
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        drug_master_id: { in: ['generic_1'] },
      },
      select: {
        drug_master_id: true,
        is_stocked: true,
        preferred_generic_id: true,
        reorder_point: true,
      },
    });
  });

  it('starts candidate and mapping reads together inside the org transaction', async () => {
    mockTarget();
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    prismaMock.drugMaster.findMany.mockImplementation(() => barrier.then(() => []));
    prismaMock.genericDrugMapping.findFirst.mockImplementation(() => barrier.then(() => null));

    const responsePromise = GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      routeContext('brand_1'),
    );

    await vi.waitFor(() => {
      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledOnce();
      expect(prismaMock.genericDrugMapping.findFirst).toHaveBeenCalledOnce();
    });
    releaseBarrier?.();

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('keeps zero and invalid price arithmetic nullable without querying site stock', async () => {
    mockTarget({ drug_price: 0 });
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'generic_zero',
        drug_name: 'Zero Generic',
        drug_price: 0,
        is_generic: true,
      },
      {
        id: 'generic_invalid',
        drug_name: 'Invalid Generic',
        drug_price: 'not-a-number',
        is_generic: true,
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      routeContext('brand_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.recommendations).toEqual([
      expect.objectContaining({ id: 'generic_zero', price_delta: 0, price_delta_percent: null }),
      expect.objectContaining({
        id: 'generic_invalid',
        price_delta: null,
        price_delta_percent: null,
      }),
    ]);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('returns a data envelope when the target has no generic name', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'brand_1',
      yj_code: '123456789012',
      drug_name: 'ノルバスク錠5mg',
      generic_name: null,
      drug_price: 20,
      unit: '錠',
      is_generic: false,
    });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        site: null,
        target: {
          id: 'brand_1',
          generic_name: null,
        },
        recommendations: [],
        reason: 'generic_name_missing',
      },
    });
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.genericDrugMapping.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
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

  it.each(['0', '21', '1.5', '1e1', 'junk'])(
    'rejects limit=%s before entering the org transaction',
    async (limit) => {
      const response = await GET(
        createRequest(
          `http://localhost/api/drug-masters/brand_1/generic-recommendations?limit=${limit}`,
        ),
        routeContext('brand_1'),
      );

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined, 8],
    ['1', 1],
    ['20', 20],
    ['%2020%20', 20],
  ])('uses the bounded limit %s as take=%i', async (limit, expectedTake) => {
    mockTarget();
    prismaMock.drugMaster.findMany.mockResolvedValue([]);
    const query = limit == null ? '' : `?limit=${limit}`;

    const response = await GET(
      createRequest(`http://localhost/api/drug-masters/brand_1/generic-recommendations${query}`),
      routeContext('brand_1'),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expectedTake }),
    );
  });

  it('rejects a blank route id before entering the org transaction', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters/%20/generic-recommendations'),
      routeContext('   '),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('stops at an org-scoped missing site before global drug reads', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters/brand_1/generic-recommendations?site_id=%20other_site%20',
      ),
      routeContext('brand_1'),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.pharmacySite.findFirst).toHaveBeenCalledWith({
      where: { id: 'other_site', org_id: 'org_1' },
      select: { id: true, name: true },
    });
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing target without candidate, mapping, or stock reads', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/missing/generic-recommendations'),
      routeContext('missing'),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.genericDrugMapping.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before recommendation reads when admin permission is denied', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({ role: 'pharmacist' });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    expectNoRecommendationReads();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '権限がありません',
    });
    await vi.waitFor(() => {
      expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
    });
    expect(
      loggerErrorMock.mock.calls.some(
        ([context]) => context?.event === 'security_event.audit_log_persist_failed',
      ),
    ).toBe(false);
  });

  it('returns no-store 401 before recommendation reads when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      routeContext('brand_1'),
    );

    expect(response.status).toBe(401);
    expectNoStore(response);
    expectNoRecommendationReads();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 before recommendation reads on auth failure', async () => {
    const unsafeError = new Error('raw generic recommendation auth secret');
    unsafeError.name = 'GenericRecommendationAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
      routeContext('brand_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expectNoRecommendationReads();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /generic recommendation auth secret|GenericRecommendationAuthSecretError/,
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-masters/brand_1/generic-recommendations',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
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
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters/brand_1/generic-recommendations',
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
    expect(logged).not.toContain('recommendation secret');
    expect(logged).not.toContain('GenericRecommendationSecretError');
  });

  it('rethrows auth and handler control flow without logging', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(
        createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
        routeContext('brand_1'),
      ),
    ).rejects.toBe(authControl);
    expectNoRecommendationReads();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    withOrgContextMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(
        createRequest('http://localhost/api/drug-masters/brand_1/generic-recommendations'),
        routeContext('brand_1'),
      ),
    ).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
