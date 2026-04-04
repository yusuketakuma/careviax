import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withRoutePerformanceMock,
  drugMasterFindUniqueMock,
  drugPackageInsertFindManyMock,
  drugInteractionFindManyMock,
  drugAlertRuleFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((req, fn) => fn()),
  drugMasterFindUniqueMock: vi.fn(),
  drugPackageInsertFindManyMock: vi.fn(),
  drugInteractionFindManyMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: (handler: (req: NextRequest, ctx: unknown, routeCtx: unknown) => Promise<Response>, options?: unknown) => {
    return async (req: NextRequest, routeCtx: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeCtx);
    };
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMaster: {
      findUnique: drugMasterFindUniqueMock,
    },
    drugPackageInsert: {
      findMany: drugPackageInsertFindManyMock,
    },
    drugInteraction: {
      findMany: drugInteractionFindManyMock,
    },
    drugAlertRule: {
      findMany: drugAlertRuleFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return {
    headers: { get: () => null },
    nextUrl: { pathname: '/api/drug-masters/drug_1/package-insert' },
    method: 'GET',
    url: 'http://localhost/api/drug-masters/drug_1/package-insert',
  } as unknown as NextRequest;
}

const mockDrug = {
  id: 'drug_1',
  yj_code: '1234567890123',
  drug_name: 'テスト薬A錠',
  drug_name_kana: 'テストヤクエーJョウ',
  generic_name: 'テスト一般名',
  drug_price: 100,
  unit: '錠',
  dosage_form: '錠剤',
  therapeutic_category: 'C03',
  manufacturer: 'テスト製薬',
  is_generic: false,
  is_narcotic: false,
  is_psychotropic: false,
  max_administration_days: 30,
  transitional_expiry_date: null,
};

const mockPackageInsert = {
  id: 'pi_1',
  contraindications: [{ text: '重篤な腎障害', severity: 'high' }],
  interactions: [{ text: 'ワルファリンとの併用注意' }],
  adverse_effects: ['発疹', '発熱'],
  dosage_adjustment_renal: null,
  precautions_elderly: [{ text: '高齢者には減量すること', detail: '標準用量の半量から開始' }],
  document_version: '第5版',
  revised_at: new Date('2025-01-01T00:00:00.000Z'),
  source_format: 'xml',
  created_at: new Date('2025-01-10T00:00:00.000Z'),
};

describe('GET /api/drug-masters/[id]/package-insert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { userId: 'user_1', orgId: 'org_1', role: 'pharmacist' },
    });
    drugMasterFindUniqueMock.mockResolvedValue(mockDrug);
    drugPackageInsertFindManyMock.mockResolvedValue([mockPackageInsert]);
    drugInteractionFindManyMock.mockResolvedValue([]);
    drugAlertRuleFindManyMock.mockResolvedValue([]);
  });

  it('returns 401 when not authenticated', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(JSON.stringify({ code: 'AUTH_UNAUTHENTICATED' }), { status: 401 }),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 404 when drug is not found', async () => {
    drugMasterFindUniqueMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('returns 200 with drug and package insert data on success', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.drug).toMatchObject({
      id: 'drug_1',
      yj_code: '1234567890123',
      drug_name: 'テスト薬A錠',
    });

    expect(body.package_insert).toMatchObject({
      id: 'pi_1',
      document_version: '第5版',
      source_format: 'xml',
    });
  });

  it('returns null package_insert when no package insert exists', async () => {
    drugPackageInsertFindManyMock.mockResolvedValue([]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.package_insert).toBeNull();
    expect(body.drug.id).toBe('drug_1');
  });

  it('returns structured sections from package insert', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    const body = await response.json();
    const sections = body.package_insert.sections;

    expect(sections.contraindications).toEqual([
      { text: '重篤な腎障害', severity: 'high', detail: undefined },
    ]);
    expect(sections.interactions).toEqual([
      { text: 'ワルファリンとの併用注意', severity: undefined, detail: undefined },
    ]);
    expect(sections.adverse_effects).toEqual([
      { text: '発疹' },
      { text: '発熱' },
    ]);
    expect(sections.precautions_elderly).toEqual([
      { text: '高齢者には減量すること', severity: undefined, detail: '標準用量の半量から開始' },
    ]);
    expect(sections.dosage_adjustment_renal).toEqual([]);
  });

  it('returns version_history with all package insert versions', async () => {
    const olderInsert = {
      ...mockPackageInsert,
      id: 'pi_old',
      document_version: '第4版',
      revised_at: new Date('2024-01-01T00:00:00.000Z'),
    };
    drugPackageInsertFindManyMock.mockResolvedValue([mockPackageInsert, olderInsert]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    const body = await response.json();
    expect(body.version_history).toHaveLength(2);
    expect(body.version_history[0].id).toBe('pi_1');
    expect(body.version_history[1].id).toBe('pi_old');
  });

  it('returns interactions from both directions merged into a unified list', async () => {
    const drugB = { id: 'drug_2', drug_name: '薬B錠', yj_code: '9876543210987' };
    const drugA = { id: 'drug_1', drug_name: 'テスト薬A錠', yj_code: '1234567890123' };

    drugInteractionFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'ix_1',
          drug_b: drugB,
          severity: 'high',
          mechanism: '代謝阻害',
          clinical_effect: 'QT延長',
          source: 'pmda',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ix_2',
          drug_a: { id: 'drug_3', drug_name: '薬C錠', yj_code: '1111111111111' },
          severity: 'moderate',
          mechanism: '競合阻害',
          clinical_effect: '血中濃度上昇',
          source: 'pmda',
        },
      ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    const body = await response.json();
    expect(body.interactions).toHaveLength(2);
    expect(body.interactions[0]).toMatchObject({
      id: 'ix_1',
      counterpart: drugB,
      severity: 'high',
    });
    expect(body.interactions[1]).toMatchObject({
      id: 'ix_2',
      severity: 'moderate',
    });
  });

  it('returns applicable alert rules matching yj_code or therapeutic category', async () => {
    drugAlertRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_1',
        alert_type: 'elderly_pim',
        severity: 'high',
        message: '高齢者への投与に注意',
        is_active: true,
        condition: { yj_codes: ['1234567890123'] },
      },
      {
        id: 'rule_2',
        alert_type: 'renal_adjustment',
        severity: 'moderate',
        message: '腎機能低下患者に注意',
        is_active: true,
        condition: { therapeutic_categories: ['C03'] },
      },
      {
        id: 'rule_3',
        alert_type: 'other',
        severity: 'low',
        message: '無関係なルール',
        is_active: true,
        condition: { yj_codes: ['9999999999999'], therapeutic_categories: ['Z99'] },
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    const body = await response.json();
    expect(body.applicable_alert_rules).toHaveLength(2);
    expect(body.applicable_alert_rules.map((r: { id: string }) => r.id)).toEqual(['rule_1', 'rule_2']);
  });

  it('returns empty applicable_alert_rules when no rules match', async () => {
    drugAlertRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_unrelated',
        alert_type: 'other',
        severity: 'low',
        message: '無関係',
        is_active: true,
        condition: { yj_codes: ['0000000000000'] },
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    });

    const body = await response.json();
    expect(body.applicable_alert_rules).toHaveLength(0);
  });
});
