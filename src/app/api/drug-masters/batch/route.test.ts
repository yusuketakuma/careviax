import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/drug-masters/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    drugMasterFindManyMock.mockResolvedValue([
      {
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
      'drug_masters_batch_post_unhandled_error',
      undefined,
      {
        event: 'drug_masters_batch_post_unhandled_error',
        route: '/api/drug-masters/batch',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('drug code secret');
    expect(logged).not.toContain('DrugMasterBatchSecretError');
  });
});
