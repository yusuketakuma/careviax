import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  ensureHomeCareBillingSsotMock,
  getHomeCareBillingSsotSummaryMock,
  billingRuleFindManyMock,
  billingRuleCreateMock,
  auditLogCreateMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  ensureHomeCareBillingSsotMock: vi.fn(),
  getHomeCareBillingSsotSummaryMock: vi.fn(),
  billingRuleFindManyMock: vi.fn(),
  billingRuleCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest) => {
      let response: Response;
      try {
        const authResult = await requireAuthContextMock(req, options);
        response =
          authResult && typeof authResult === 'object' && 'response' in authResult
            ? authResult.response
            : await handler(req, authResult.ctx);
      } catch (error) {
        loggerErrorMock(
          {
            event: 'route_handler_unhandled_error',
            route: req.nextUrl.pathname,
            method: req.method,
            requestId: '00000000-0000-4000-8000-000000000001',
            correlationId: 'billing_rules_test',
          },
          error,
        );
        response = new Response(
          JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'サーバー内部でエラーが発生しました',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('X-Request-Id', '00000000-0000-4000-8000-000000000001');
      response.headers.set('X-Correlation-Id', 'billing_rules_test');
      return response;
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/billing-rules', () => ({
  ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  getHomeCareBillingSsotSummary: getHomeCareBillingSsotSummaryMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url = 'http://localhost/api/billing-rules', body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-org-id': 'org_1',
      'x-correlation-id': 'billing_rules_test',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/billing-rules', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'x-correlation-id': 'billing_rules_test',
      'content-type': 'application/json',
    },
    body: '{bad json',
  } satisfies NextRequestInit);
}

async function expectInternalError(response: Response, rawMessage: string) {
  expect(response.status).toBe(500);
  expectNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject({
    code: 'INTERNAL_ERROR',
    message: 'サーバー内部でエラーが発生しました',
  });
  expect(JSON.stringify(body)).not.toContain(rawMessage);
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
        auditLog: {
          create: auditLogCreateMock,
        },
        billingRule: {
          findMany: billingRuleFindManyMock,
          create: billingRuleCreateMock,
        },
      }),
    );
  });

  it('returns billing SSOT rules without mutating the catalog on GET', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-rules?billing_scope=home_care_ssot'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    expect(resolvedResponse.headers.get('X-Request-Id')).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(resolvedResponse.headers.get('X-Correlation-Id')).toBe('billing_rules_test');
    expect(ensureHomeCareBillingSsotMock).not.toHaveBeenCalled();
    const body = await resolvedResponse.json();
    expect(body).toMatchObject({
      data: [
        {
          billing_scope: 'home_care_ssot',
          code: 'MED_HOME_VISIT_SINGLE',
        },
      ],
      meta: {
        summary: {
          ssot_rule_count: 16,
        },
      },
    });
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('summary');
  });

  it('normalizes malformed rule JSON fields to empty objects on GET', async () => {
    billingRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_malformed',
        org_id: 'org_1',
        billing_scope: 'home_care_ssot',
        rule_type: 'base',
        service_type: 'medical_home_visit',
        payer_basis: 'medical',
        provider_scope: 'pharmacy',
        selection_mode: 'auto',
        calculation_unit: 'point',
        name: '不正JSONルール',
        code: 'MALFORMED',
        conditions: ['unexpected'],
        evidence_requirements: 'invalid',
        source_url: null,
        source_note: null,
        amount: 0,
        is_system: true,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const response = await GET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      data: [
        {
          code: 'MALFORMED',
          conditions: {},
          evidence_requirements: {},
        },
      ],
    });
  });

  it('rejects invalid GET query enums before SSOT sync or billing rule lookup', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-rules?rule_type=bad&billing_scope=%20&service_type=bad',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        rule_type: ['rule_type が不正です'],
        billing_scope: ['billing_scope が不正です'],
        service_type: ['service_type が不正です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(ensureHomeCareBillingSsotMock).not.toHaveBeenCalled();
    expect(billingRuleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate and non-boolean GET filters before billing rule lookup', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-rules?rule_type=base&rule_type=addition&include_inactive=yes',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        rule_type: ['rule_type が不正です'],
        include_inactive: ['include_inactive が不正です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(ensureHomeCareBillingSsotMock).not.toHaveBeenCalled();
    expect(getHomeCareBillingSsotSummaryMock).not.toHaveBeenCalled();
    expect(billingRuleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when GET throws unexpectedly', async () => {
    const rawMessage = 'raw billing SQL stack';
    getHomeCareBillingSsotSummaryMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await GET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    await expectInternalError(response as Response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/billing-rules',
        method: 'GET',
      }),
      expect.any(Error),
    );
  });

  it('rejects non-object POST payloads before SSOT sync or billing rule create', async () => {
    const response = await POST(
      createRequest('http://localhost/api/billing-rules', []),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(ensureHomeCareBillingSsotMock).not.toHaveBeenCalled();
    expect(billingRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST payloads before SSOT sync or billing rule create', async () => {
    const response = await POST(createMalformedJsonPostRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(ensureHomeCareBillingSsotMock).not.toHaveBeenCalled();
    expect(billingRuleCreateMock).not.toHaveBeenCalled();
  });

  it('re-seeds official SSOT via POST action', async () => {
    const response = await POST(
      createRequest('http://localhost/api/billing-rules', { action: 'seed_home_care_ssot' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(201);
    expectNoStore(resolvedResponse);
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'billing_rules_ssot_seeded',
          target_type: 'BillingRule',
          target_id: 'home_care_ssot',
        }),
      }),
    );
    const body = await resolvedResponse.json();
    expect(body).toMatchObject({
      data: {
        message: '在宅請求 SSOT の公式算定ルールを同期しました',
        seeded: 16,
      },
    });
    expect(body).not.toHaveProperty('message');
    expect(body).not.toHaveProperty('seeded');
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
        conditions: { patient_status: 'active' },
        evidence_requirements: { required_documents: ['visit_record'] },
        amount: 10,
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(201);
    expectNoStore(resolvedResponse);
    expect(billingRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billing_scope: 'custom',
        rule_type: 'addition',
        amount: 10,
        conditions: { patient_status: 'active' },
        evidence_requirements: { required_documents: ['visit_record'] },
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'billing_rule_created',
          target_type: 'BillingRule',
          target_id: 'custom_1',
        }),
      }),
    );
    const body = await resolvedResponse.json();
    expect(body).toMatchObject({
      data: {
        id: 'custom_1',
        conditions: {},
        evidence_requirements: {},
      },
    });
    expect(body).not.toHaveProperty('id');
  });

  it('returns a sanitized no-store 500 when POST create throws unexpectedly', async () => {
    const rawMessage = 'raw create billing failure';
    billingRuleCreateMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/billing-rules', {
        rule_type: 'addition',
        name: '任意加算',
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    await expectInternalError(response as Response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/billing-rules',
        method: 'POST',
      }),
      expect.any(Error),
    );
  });
});
