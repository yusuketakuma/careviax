import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { expectNoStore } from '@/test/api-response-assertions';
import { drugMasterDetailResponseSchema } from '@/app/(dashboard)/admin/drug-masters/drug-master-content-contracts';

const {
  authMock,
  membershipFindFirstMock,
  auditLogCreateMock,
  drugMasterFindUniqueMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  drugMasterFindUniqueMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      create: auditLogCreateMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    drugMaster: {
      findUnique: drugMasterFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { drugMasterDetailCache } from '@/server/services/drug-master-detail-cache';
import { GET } from './route';

function createRequest(headers: Record<string, string> = { 'x-org-id': 'org_1' }) {
  return new NextRequest('http://localhost/api/drug-masters/drug_1', { headers });
}

function createRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('/api/drug-masters/[id]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    drugMasterDetailCache.clear();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    drugMasterFindUniqueMock.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'アセトアミノフェン',
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    });
  });

  it('returns no-store 401 before querying safety data when unauthenticated', async () => {
    drugMasterDetailCache.set(
      'drug-masters:detail-cache:id:drug_1',
      {
        id: 'drug_1',
        drug_name: 'キャッシュ済み機微データ',
      },
      120_000,
    );
    const cacheGetSpy = vi.spyOn(drugMasterDetailCache, 'get');
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), createRouteContext('drug_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('キャッシュ済み機微データ');
  });

  it.each(['clerk', 'driver'] as const)(
    'preserves auth-only detail access for an active %s member',
    async (role) => {
      membershipFindFirstMock.mockResolvedValueOnce({ role, site_id: null });

      const response = await GET(createRequest(), createRouteContext('drug_1'));

      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(drugMasterFindUniqueMock).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the drug master detail with related safety data', async () => {
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');
    const response = await GET(createRequest(), createRouteContext('  drug_1  '));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(drugMasterFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'drug_1' },
      include: {
        package_inserts: {
          orderBy: { revised_at: 'desc' },
          take: 1,
          select: {
            id: true,
            contraindications: true,
            interactions: true,
            adverse_effects: true,
            dosage_adjustment_renal: true,
            precautions_elderly: true,
            document_version: true,
            revised_at: true,
          },
        },
        interactions_as_a: {
          include: {
            drug_b: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
        interactions_as_b: {
          include: {
            drug_a: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
      },
    });
    expect(cacheSetSpy).toHaveBeenCalledWith(
      'drug-masters:detail-cache:id:drug_1',
      expect.objectContaining({ id: 'drug_1', drug_name: 'アセトアミノフェン' }),
      120_000,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'drug_1',
        drug_name: 'アセトアミノフェン',
      },
    });
  });

  it('keeps Prisma Decimal prices compatible with the production detail consumer', async () => {
    drugMasterFindUniqueMock.mockResolvedValueOnce({
      id: 'drug_1',
      yj_code: '111111111111',
      receipt_code: null,
      jan_code: null,
      drug_name: 'アセトアミノフェン',
      drug_name_kana: null,
      generic_name: null,
      drug_price: new Prisma.Decimal('12.30'),
      unit: '錠',
      dosage_form: null,
      therapeutic_category: null,
      manufacturer: null,
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: false,
      outpatient_injection_eligible: false,
      outpatient_injection_note: null,
      is_lasa_risk: false,
      tall_man_name: null,
      lasa_group_key: null,
      max_administration_days: null,
      hot_code: null,
      transitional_expiry_date: null,
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    });

    const response = await GET(createRequest(), createRouteContext('drug_1'));

    expect(response.status).toBe(200);
    const parsed = drugMasterDetailResponseSchema.parse(await response.json());
    expect(parsed.data.drug_price).toBe(12.3);
  });

  it('returns cached drug master detail in a data envelope', async () => {
    const first = await GET(createRequest(), createRouteContext('drug_1'));
    if (!first) throw new Error('first response is required');
    expect(first.status).toBe(200);
    expectNoStore(first);
    await expect(first.json()).resolves.toMatchObject({
      data: { id: 'drug_1', drug_name: 'アセトアミノフェン' },
    });

    drugMasterFindUniqueMock.mockClear();
    const second = await GET(createRequest(), createRouteContext('drug_1'));
    if (!second) throw new Error('second response is required');
    expect(second.status).toBe(200);
    expectNoStore(second);
    await expect(second.json()).resolves.toMatchObject({
      data: { id: 'drug_1', drug_name: 'アセトアミノフェン' },
    });
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
  });

  it('does not truncate interactions before prioritizing contraindications', async () => {
    drugMasterFindUniqueMock.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'アセトアミノフェン',
      package_inserts: [],
      interactions_as_a: [
        {
          id: 'interaction_caution',
          severity: 'caution',
          drug_b: { id: 'drug_b', drug_name: '注意薬', yj_code: '111111111111' },
        },
        {
          id: 'interaction_contraindicated',
          severity: 'contraindicated',
          drug_b: { id: 'drug_c', drug_name: '禁忌薬', yj_code: '222222222222' },
        },
        {
          id: 'interaction_minor',
          severity: 'minor',
          drug_b: { id: 'drug_d', drug_name: '参考薬', yj_code: '333333333333' },
        },
      ],
      interactions_as_b: [
        {
          id: 'interaction_b_minor',
          severity: 'minor',
          drug_a: { id: 'drug_e', drug_name: '参考薬B', yj_code: '444444444444' },
        },
        {
          id: 'interaction_b_contraindicated',
          severity: 'contraindicated',
          drug_a: { id: 'drug_f', drug_name: '禁忌薬B', yj_code: '555555555555' },
        },
      ],
    });

    const response = await GET(createRequest(), createRouteContext('drug_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();
    expect(drugMasterFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          interactions_as_a: {
            include: {
              drug_b: { select: { id: true, drug_name: true, yj_code: true } },
            },
          },
          interactions_as_b: {
            include: {
              drug_a: { select: { id: true, drug_name: true, yj_code: true } },
            },
          },
        }),
      }),
    );
    expect(
      body.data.interactions_as_a.map((interaction: { id: string }) => interaction.id),
    ).toEqual(['interaction_contraindicated', 'interaction_caution', 'interaction_minor']);
    expect(
      body.data.interactions_as_b.map((interaction: { id: string }) => interaction.id),
    ).toEqual(['interaction_b_contraindicated', 'interaction_b_minor']);
  });

  it('rejects blank drug master ids before querying safety data', async () => {
    const cacheGetSpy = vi.spyOn(drugMasterDetailCache, 'get');
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');
    const response = await GET(createRequest(), createRouteContext('   '));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品IDが不正です',
    });
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 when the drug master is not found', async () => {
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');
    drugMasterFindUniqueMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), createRouteContext('missing_drug'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品が見つかりません',
    });
    expect(cacheSetSpy).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when detail lookup fails unexpectedly', async () => {
    const cacheSetSpy = vi.spyOn(drugMasterDetailCache, 'set');
    const unsafeError = new Error('raw drug interaction secret');
    unsafeError.name = 'DrugMasterDetailSecretError';
    drugMasterFindUniqueMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest(), createRouteContext('drug_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('interaction secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters/drug_1',
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
    expect(logged).not.toContain('interaction secret');
    expect(logged).not.toContain('DrugMasterDetailSecretError');
    expect(cacheSetSpy).not.toHaveBeenCalled();
  });
});
