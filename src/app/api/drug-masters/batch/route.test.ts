import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { authMock, membershipFindFirstMock, drugMasterFindManyMock, loggerErrorMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    drugMasterFindManyMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }),
);

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
        drug_price: 10,
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
    const response = await POST(
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
    expect(drugMasterFindManyMock.mock.calls[0]?.[0].select).toEqual(
      expect.objectContaining({
        id: true,
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: true,
        lasa_group_key: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      '1111111A': expect.objectContaining({
        drug_name: 'アセトアミノフェン',
        tall_man_name: 'acetAMINOPHEN',
      }),
      by_drug_master_id: {
        drug_1: expect.objectContaining({
          yj_code: '1111111A',
        }),
      },
    });
  });

  it('keeps a valid lookup miss as an empty success instead of a false error', async () => {
    drugMasterFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(createRequest({ drug_master_ids: ['missing_drug_master'] }));

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({ by_drug_master_id: {} });
  });

  it('deduplicates over the combined lookup keys before enforcing the 200 key limit', async () => {
    const response = await POST(
      createRequest({
        yj_codes: Array.from({ length: 201 }, () => '1111111A'),
      }),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { yj_code: { in: ['1111111A'] } },
      select: expect.any(Object),
    });
  });

  it('rejects lookup payloads over the combined unique 200 key limit before querying drug masters', async () => {
    const response = await POST(
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
        drug_price: 20,
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

    const response = await POST(
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
      YJ_SELECTED: expect.objectContaining({ id: 'drug_master_selected' }),
      by_drug_master_id: {
        drug_master_selected: expect.objectContaining({
          id: 'drug_master_selected',
          yj_code: 'YJ_SELECTED',
          tall_man_name: 'selectedTALL',
        }),
      },
    });
  });

  it('supports mixed yj code and drug master id lookup without breaking the flat response map', async () => {
    const response = await POST(
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
      '1111111A': expect.objectContaining({ id: 'drug_1' }),
      by_drug_master_id: {
        drug_1: expect.objectContaining({ yj_code: '1111111A' }),
      },
    });
  });

  it('rejects non-object batch payloads before querying drug masters', async () => {
    const response = await POST(createRequest([]));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before querying drug masters', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank yj codes before querying drug masters', async () => {
    const response = await POST(createRequest({ yj_codes: ['1111111A', '   '] }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects empty lookup payloads before querying drug masters', async () => {
    const response = await POST(createRequest({ yj_codes: [], drug_master_ids: [] }));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store 401 before parsing the body when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await POST(createRequest({ yj_codes: ['1111111A'] }));

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when batch lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw batch drug code secret');
    unsafeError.name = 'DrugMasterBatchSecretError';
    drugMasterFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createRequest({ yj_codes: ['1111111A'] }));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('drug code secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'drug_masters_batch_post_unhandled_error',
        route: '/api/drug-masters/batch',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('drug code secret');
    expect(logged).not.toContain('DrugMasterBatchSecretError');
  });
});
