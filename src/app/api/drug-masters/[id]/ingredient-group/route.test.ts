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
import { ingredientGroupResponseSchema } from '@/app/(dashboard)/admin/drug-masters/drug-master-content-contracts';

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

function expectNoGroupReads() {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
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

describe('/api/drug-masters/[id]/ingredient-group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    securityEventExecuteRawMock.mockResolvedValue(0);
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
      },
    });
    expect(ingredientGroupResponseSchema.safeParse(payload).success).toBe(true);
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        drug_master_id: { in: ['brand_1', 'generic_1'] },
      },
      select: {
        drug_master_id: true,
        is_stocked: true,
        preferred_generic_id: true,
        reorder_point: true,
        follow_up_status: true,
      },
    });
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith({
      where: { generic_name: 'アムロジピンベシル酸塩' },
      orderBy: [{ is_generic: 'asc' }, { drug_price: 'asc' }, { drug_name_kana: 'asc' }],
      take: 2,
      select: {
        id: true,
        yj_code: true,
        drug_name: true,
        generic_name: true,
        drug_price: true,
        unit: true,
        manufacturer: true,
        is_generic: true,
        transitional_expiry_date: true,
      },
    });
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
      data: {
        generic_name: null,
        summary: null,
        members: [],
        reason: 'generic_name_missing',
      },
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

  it('returns 404 for a missing target before member or stock reads', async () => {
    prismaMock.drugMaster.findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/missing/ingredient-group'),
      routeContext('missing'),
    );

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('keeps no-site stock counts nullable and ignores non-finite member prices', async () => {
    mockTarget();
    prismaMock.drugMaster.findMany.mockResolvedValue([
      { id: 'brand_1', is_generic: false, drug_price: '0' },
      { id: 'generic_1', is_generic: true, drug_price: 'not-a-number' },
      { id: 'generic_2', is_generic: true, drug_price: null },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
      routeContext('brand_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary).toEqual({
      member_count: 3,
      brand_count: 1,
      generic_count: 2,
      stocked_count: 0,
      unstocked_count: null,
      lowest_price: 0,
      highest_price: 0,
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
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

  it.each(['0', '101', '1.5', '1e2', 'junk'])(
    'rejects limit=%s before entering the org transaction',
    async (limit) => {
      const response = await GET(
        createRequest(`http://localhost/api/drug-masters/brand_1/ingredient-group?limit=${limit}`),
        routeContext('brand_1'),
      );

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined, 50],
    ['1', 1],
    ['100', 100],
    ['%20100%20', 100],
  ])('uses bounded limit %s as take=%i', async (limit, expectedTake) => {
    mockTarget();
    prismaMock.drugMaster.findMany.mockResolvedValue([]);
    const query = limit == null ? '' : `?limit=${limit}`;

    const response = await GET(
      createRequest(`http://localhost/api/drug-masters/brand_1/ingredient-group${query}`),
      routeContext('brand_1'),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expectedTake }),
    );
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('rejects a blank route id before entering the org transaction', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters/%20/ingredient-group'),
      routeContext('   '),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns no-store 403 before group reads when admin permission is denied', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({ role: 'pharmacist' });

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group?site_id=site_1'),
      { params: Promise.resolve({ id: 'brand_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    expectNoGroupReads();
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

  it('returns no-store 401 before group reads when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
      routeContext('brand_1'),
    );

    expect(response.status).toBe(401);
    expectNoStore(response);
    expectNoGroupReads();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 before group reads on auth failure', async () => {
    const unsafeError = new Error('raw ingredient group auth secret');
    unsafeError.name = 'IngredientGroupAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
      routeContext('brand_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expectNoGroupReads();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /ingredient group auth secret|IngredientGroupAuthSecretError/,
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-masters/brand_1/ingredient-group',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
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
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters/brand_1/ingredient-group',
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
    expect(logged).not.toContain('ingredient group secret');
    expect(logged).not.toContain('IngredientGroupSecretError');
  });

  it('rethrows auth and handler control flow without logging', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(
        createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
        routeContext('brand_1'),
      ),
    ).rejects.toBe(authControl);
    expectNoGroupReads();
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
        createRequest('http://localhost/api/drug-masters/brand_1/ingredient-group'),
        routeContext('brand_1'),
      ),
    ).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
