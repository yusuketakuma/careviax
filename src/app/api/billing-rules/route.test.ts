import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  ensureHomeCareBillingSsotMock,
  getHomeCareBillingSsotSummaryMock,
  billingRuleFindManyMock,
  billingRuleCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  ensureHomeCareBillingSsotMock: vi.fn(),
  getHomeCareBillingSsotSummaryMock: vi.fn(),
  billingRuleFindManyMock: vi.fn(),
  billingRuleCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/home-care-billing-ssot', () => ({
  ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  getHomeCareBillingSsotSummary: getHomeCareBillingSsotSummaryMock,
}));

import { GET, POST } from './route';

function createRequest(url = 'http://localhost/api/billing-rules', body?: unknown) {
  return {
    url,
    headers: {
      get: () => 'org_1',
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/billing-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
      },
    });
    ensureHomeCareBillingSsotMock.mockResolvedValue({ seeded: 16 });
    getHomeCareBillingSsotSummaryMock.mockResolvedValue({
      source: {
        source_of_truth: 'ph-os',
        sync_direction: 'push',
      },
      rules: new Array(16).fill(null).map((_, index) => ({ id: `system_${index}` })),
    });
    billingRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_1',
        org_id: 'org_1',
        billing_scope: 'home_care_ssot',
        rule_type: 'base',
        service_type: 'medical_home_visit',
        payer_basis: 'medical',
        provider_scope: 'pharmacy',
        selection_mode: 'auto',
        calculation_unit: 'point',
        name: '在宅患者訪問薬剤管理指導料 単一建物1人',
        code: 'MED_HOME_VISIT_SINGLE',
        conditions: { building_tier: 'single' },
        evidence_requirements: {},
        source_url: 'https://example.com',
        source_note: 'official',
        amount: 650,
        is_system: true,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    billingRuleCreateMock.mockResolvedValue({
      id: 'custom_1',
      org_id: 'org_1',
      billing_scope: 'custom',
      rule_type: 'addition',
      service_type: 'medical_home_visit',
      payer_basis: 'medical',
      provider_scope: 'pharmacy',
      selection_mode: 'manual',
      calculation_unit: 'point',
      display_order: 1000,
      name: '任意加算',
      code: 'CUSTOM_ADD',
      conditions: {},
      evidence_requirements: {},
      source_url: null,
      source_note: null,
      amount: 10,
      is_system: false,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingRule: {
          findMany: billingRuleFindManyMock,
          create: billingRuleCreateMock,
        },
      })
    );
  });

  it('seeds and returns billing SSOT rules on GET', async () => {
    const response = await GET(createRequest('http://localhost/api/billing-rules?billing_scope=home_care_ssot'));

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(ensureHomeCareBillingSsotMock).toHaveBeenCalledWith(expect.anything(), 'org_1');
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      data: [
        {
          billing_scope: 'home_care_ssot',
          code: 'MED_HOME_VISIT_SINGLE',
        },
      ],
      summary: {
        ssot_rule_count: 16,
      },
    });
  });

  it('re-seeds official SSOT via POST action', async () => {
    const response = await POST(
      createRequest('http://localhost/api/billing-rules', { action: 'seed_home_care_ssot' })
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(201);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      message: '在宅請求 SSOT の公式算定ルールを同期しました',
      seeded: 16,
    });
  });

  it('creates a custom billing rule', async () => {
    const response = await POST(
      createRequest('http://localhost/api/billing-rules', {
        rule_type: 'addition',
        service_type: 'medical_home_visit',
        payer_basis: 'medical',
        provider_scope: 'pharmacy',
        name: '任意加算',
        code: 'CUSTOM_ADD',
        conditions: {},
        amount: 10,
      })
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(201);
    expect(billingRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billing_scope: 'custom',
        rule_type: 'addition',
        amount: 10,
      }),
    });
  });
});
