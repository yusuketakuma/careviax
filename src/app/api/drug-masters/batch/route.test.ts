import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  drugMasterFindManyMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
}));

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
    drugMaster: {
      findMany: drugMasterFindManyMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { drugMasterDetailCache } from '@/server/services/drug-master-detail-cache';
import { POST } from './route';

const drugMasterInfoSchema = z.object({
  id: z.string(),
  yj_code: z.string(),
  drug_name: z.string(),
  dosage_form: z.string().nullable(),
  drug_price: z.number().nullable(),
  unit: z.string().nullable(),
  is_generic: z.boolean(),
  is_narcotic: z.boolean(),
  is_psychotropic: z.boolean(),
  is_high_risk: z.boolean(),
  is_lasa_risk: z.boolean(),
  tall_man_name: z.string().nullable(),
  lasa_group_key: z.string().nullable(),
  max_administration_days: z.number().int().nullable(),
  therapeutic_category: z.string().nullable(),
});

const drugMasterBatchApiResponseSchema = z
  .object({
    data: z.record(
      z.string(),
      z.union([drugMasterInfoSchema, z.record(z.string(), drugMasterInfoSchema)]),
    ),
  })
  .strict();

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-masters/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/drug-masters/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

async function invokePost(request: NextRequest) {
  return POST(request, { params: Promise.resolve({}) });
}

describe('/api/drug-masters/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterDetailCache.clear();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1111111A',
        drug_name: 'アセトアミノフェン',
        dosage_form: '錠剤',
        drug_price: new Prisma.Decimal('10.50'),
        unit: '錠',
        is_generic: true,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: 'acetAMINOPHEN',
        lasa_group_key: 'acetaminophen_anticoagulant',
        max_administration_days: 30,
        therapeutic_category: '解熱鎮痛薬',
      },
    ]);
  });

  it('returns drug master records keyed by yj code', async () => {
    const response = await invokePost(
      createRequest({
        yj_codes: [' 1111111A ', '1111111A'],
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { yj_code: { in: ['1111111A'] } },
      select: expect.any(Object),
    });
    expect(drugMasterFindManyMock.mock.calls[0]?.[0].select).toEqual({
      id: true,
      yj_code: true,
      drug_name: true,
      dosage_form: true,
      drug_price: true,
      unit: true,
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: true,
      is_high_risk: true,
      is_lasa_risk: true,
      tall_man_name: true,
      lasa_group_key: true,
      max_administration_days: true,
      therapeutic_category: true,
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        '1111111A': expect.objectContaining({
          drug_name: 'アセトアミノフェン',
          drug_price: 10.5,
          tall_man_name: 'acetAMINOPHEN',
        }),
        by_drug_master_id: {
          drug_1: expect.objectContaining({
            yj_code: '1111111A',
            drug_price: 10.5,
          }),
        },
      },
    });
    expect(drugMasterBatchApiResponseSchema.safeParse(body).success).toBe(true);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
  });

  it('returns the same numeric wire from the normalized cache key without a second query', async () => {
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');

    const first = await invokePost(
      createRequest({ yj_codes: ['YJ_NULL', '1111111A'], drug_master_ids: ['drug_1'] }),
    );
    expect(first.status).toBe(200);
    expectNoStore(first);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      data: {
        '1111111A': expect.objectContaining({ drug_price: 10.5 }),
        by_drug_master_id: {
          drug_1: expect.objectContaining({ drug_price: 10.5 }),
        },
      },
    });
    expect(drugMasterBatchApiResponseSchema.safeParse(firstBody).success).toBe(true);
    expect(cacheSetSpy).toHaveBeenCalledOnce();
    expect(cacheSetSpy.mock.calls[0]?.[2]).toBe(120_000);

    drugMasterFindManyMock.mockClear();
    cacheSetSpy.mockClear();
    const second = await invokePost(
      createRequest({
        yj_codes: ['1111111A', 'YJ_NULL', '1111111A'],
        drug_master_ids: ['drug_1', 'drug_1'],
      }),
    );
    expect(second.status).toBe(200);
    expectNoStore(second);
    await expect(second.json()).resolves.toEqual(firstBody);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a valid lookup miss as an empty success instead of a false error', async () => {
    drugMasterFindManyMock.mockResolvedValueOnce([]);

    const response = await invokePost(createRequest({ drug_master_ids: ['missing_drug_master'] }));

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: { by_drug_master_id: {} } });
  });

  it('deduplicates over the combined lookup keys before enforcing the 200 key limit', async () => {
    const response = await invokePost(
      createRequest({
        yj_codes: Array.from({ length: 400 }, () => '1111111A'),
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { yj_code: { in: ['1111111A'] } },
      select: expect.any(Object),
    });
  });

  it('rejects an input array over its raw 400 item schema limit before cache or database access', async () => {
    const cacheGetSpy = vi.spyOn(drugMasterDetailCache, 'get');
    const response = await invokePost(
      createRequest({ yj_codes: Array.from({ length: 401 }, () => '1111111A') }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 200 unique keys across the separate yj and id namespaces', async () => {
    const response = await invokePost(
      createRequest({
        yj_codes: Array.from({ length: 100 }, (_, index) => `shared_${index}`),
        drug_master_ids: Array.from({ length: 100 }, (_, index) => `shared_${index}`),
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { yj_code: { in: Array.from({ length: 100 }, (_, index) => `shared_${index}`) } },
          { id: { in: Array.from({ length: 100 }, (_, index) => `shared_${index}`) } },
        ],
      },
      select: expect.any(Object),
    });
  });

  it('rejects lookup payloads over the combined unique 200 key limit before querying drug masters', async () => {
    const response = await invokePost(
      createRequest({
        yj_codes: Array.from({ length: 100 }, (_, index) => `YJ${index}`),
        drug_master_ids: Array.from({ length: 101 }, (_, index) => `drug_${index}`),
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        yj_codes: ['yj_codes と drug_master_ids は重複除去後の合計200件以内で指定してください'],
      },
    });
  });

  it('returns drug master records keyed by drug master id when requested by id only', async () => {
    drugMasterFindManyMock.mockResolvedValueOnce([
      {
        id: 'drug_master_selected',
        yj_code: 'YJ_SELECTED',
        drug_name: '薬剤マスター選択薬',
        dosage_form: '錠剤',
        drug_price: null,
        unit: '錠',
        is_generic: false,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: false,
        tall_man_name: 'selectedTALL',
        lasa_group_key: null,
        max_administration_days: 14,
        therapeutic_category: '循環器官用薬',
      },
    ]);

    const response = await invokePost(
      createRequest({
        drug_master_ids: [' drug_master_selected ', 'drug_master_selected'],
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['drug_master_selected'] } },
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        YJ_SELECTED: expect.objectContaining({ id: 'drug_master_selected' }),
        by_drug_master_id: {
          drug_master_selected: expect.objectContaining({
            id: 'drug_master_selected',
            yj_code: 'YJ_SELECTED',
            drug_price: null,
            tall_man_name: 'selectedTALL',
          }),
        },
      },
    });
  });

  it('supports mixed yj code and drug master id lookup without breaking the flat response map', async () => {
    const response = await invokePost(
      createRequest({
        yj_codes: ['1111111A'],
        drug_master_ids: ['drug_1'],
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [{ yj_code: { in: ['1111111A'] } }, { id: { in: ['drug_1'] } }],
      },
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        '1111111A': expect.objectContaining({ id: 'drug_1' }),
        by_drug_master_id: {
          drug_1: expect.objectContaining({ yj_code: '1111111A' }),
        },
      },
    });
  });

  it('rejects non-object batch payloads before querying drug masters', async () => {
    const response = await invokePost(createRequest([]));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before querying drug masters', async () => {
    const response = await invokePost(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank yj codes before querying drug masters', async () => {
    const response = await invokePost(createRequest({ yj_codes: ['1111111A', '   '] }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects empty lookup payloads before querying drug masters', async () => {
    const response = await invokePost(createRequest({ yj_codes: [], drug_master_ids: [] }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store 401 before parsing the body when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);
    const request = createMalformedJsonRequest();
    const cacheGetSpy = vi.spyOn(drugMasterDetailCache, 'get');
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');

    const response = await invokePost(request);

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('preserves auth-only access for a non-admin active member', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk', site_id: null });

    const response = await invokePost(createRequest({ yj_codes: ['1111111A'] }));

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
  });

  it('returns a traced safe 500 before reading the body or cache when auth fails', async () => {
    const unsafeError = new Error('raw batch auth secret');
    unsafeError.name = 'DrugMasterBatchAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);
    const request = createMalformedJsonRequest();
    const cacheGetSpy = vi.spyOn(drugMasterDetailCache, 'get');
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');

    const response = await invokePost(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(/batch auth secret|DrugMasterBatchAuthSecretError/);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-masters/batch',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
  });

  it('returns a sanitized no-store 500 when batch lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw batch drug code secret');
    unsafeError.name = 'DrugMasterBatchSecretError';
    drugMasterFindManyMock.mockRejectedValueOnce(unsafeError);
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');

    const response = await invokePost(createRequest({ yj_codes: ['1111111A'] }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('drug code secret');
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters/batch',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('drug code secret');
    expect(logged).not.toContain('DrugMasterBatchSecretError');

    const retry = await invokePost(createRequest({ yj_codes: ['1111111A'] }));
    expect(retry.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledTimes(2);
    expect(cacheSetSpy).toHaveBeenCalledOnce();
  });

  it('rethrows auth and handler control flow without logging or caching', async () => {
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(invokePost(createMalformedJsonRequest())).rejects.toBe(authControl);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    drugMasterFindManyMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(invokePost(createRequest({ yj_codes: ['1111111A'] }))).rejects.toBe(
      handlerControl,
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
