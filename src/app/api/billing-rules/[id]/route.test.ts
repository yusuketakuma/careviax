import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  billingRuleFindFirstMock,
  billingRuleUpdateMock,
  billingRuleUpdateManyMock,
  billingRuleDeleteMock,
  billingRuleDeleteManyMock,
  auditLogCreateMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  billingRuleFindFirstMock: vi.fn(),
  billingRuleUpdateMock: vi.fn(),
  billingRuleUpdateManyMock: vi.fn(),
  billingRuleDeleteMock: vi.fn(),
  billingRuleDeleteManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { DELETE, GET, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const CURRENT_UPDATED_AT = '2026-06-19T00:00:00.000Z';

function createRequest(method: 'DELETE' | 'GET' | 'PATCH', body?: unknown) {
  const url =
    method === 'DELETE'
      ? `http://localhost/api/billing-rules/rule_1?expected_updated_at=${encodeURIComponent(
          CURRENT_UPDATED_AT,
        )}`
      : 'http://localhost/api/billing-rules/rule_1';
  const init: NextRequestInit = {
    method,
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(
      method === 'PATCH' && body && typeof body === 'object' && !Array.isArray(body)
        ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
        : body,
    );
  }
  return new NextRequest(url, init);
}

function createDeleteRequestWithoutExpectedUpdatedAt() {
  return new NextRequest('http://localhost/api/billing-rules/rule_1', {
    method: 'DELETE',
    headers: { 'x-org-id': 'org_1' },
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/billing-rules/rule_1', {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
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

describe('/api/billing-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
      },
    });
    billingRuleUpdateMock.mockResolvedValue({
      id: 'rule_1',
      is_active: false,
      conditions: {},
      evidence_requirements: {},
    });
    billingRuleUpdateManyMock.mockResolvedValue({ count: 1 });
    billingRuleDeleteManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        auditLog: {
          create: auditLogCreateMock,
        },
        billingRule: {
          findFirst: billingRuleFindFirstMock,
          update: billingRuleUpdateMock,
          updateMany: billingRuleUpdateManyMock,
          delete: billingRuleDeleteMock,
          deleteMany: billingRuleDeleteManyMock,
        },
      }),
    );
  });

  it('normalizes malformed rule JSON fields to empty objects on GET', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      conditions: ['unexpected'],
      evidence_requirements: 'invalid',
    });

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    const body = await resolvedResponse.json();
    expect(body).toMatchObject({
      data: {
        id: 'rule_1',
        conditions: {},
        evidence_requirements: {},
      },
    });
    expect(body).not.toHaveProperty('id');
  });

  it('rejects blank GET route ids before rule lookup', async () => {
    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      message: '算定ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when GET throws unexpectedly', async () => {
    const rawMessage = 'raw get billing rule failure';
    billingRuleFindFirstMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response as Response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'billing_rules_id_get_unhandled_error',
        route: '/api/billing-rules/:id',
        status: 500,
      }),
      expect.any(Error),
    );
  });

  it('blocks non-active field changes for system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await PATCH(
      createRequest('PATCH', { name: '変更したい', expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'rule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object PATCH payloads before rule lookup or update', async () => {
    const response = await PATCH(createRequest('PATCH', []), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PATCH payloads before rule lookup or update', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank PATCH route ids before rule lookup or update', async () => {
    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      message: '算定ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth rejection for PATCH before rule lookup or update', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(403);
    expectNoStore(resolvedResponse);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before PATCH lookup or update', async () => {
    const response = await PATCH(
      createRequest('PATCH', { is_active: false, expected_updated_at: undefined }),
      {
        params: Promise.resolve({ id: 'rule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('allows active toggle for system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
      is_active: false,
      conditions: {},
      evidence_requirements: {},
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    const body = await resolvedResponse.json();
    expect(body).toMatchObject({
      data: {
        id: 'rule_1',
        is_active: false,
        conditions: {},
        evidence_requirements: {},
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(billingRuleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'rule_1', org_id: 'org_1', updated_at: new Date(CURRENT_UPDATED_AT) },
      data: { is_active: false },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'billing_rule_updated',
          target_type: 'BillingRule',
          target_id: 'rule_1',
        }),
      }),
    );
  });

  it('updates custom rule JSON fields', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      conditions: { patient_status: 'active' },
      evidence_requirements: { required_documents: ['visit_record'] },
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });

    const response = await PATCH(
      createRequest('PATCH', {
        conditions: { patient_status: 'active' },
        evidence_requirements: { required_documents: ['visit_record'] },
      }),
      { params: Promise.resolve({ id: 'rule_1' }) },
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    expect(billingRuleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'rule_1', org_id: 'org_1', updated_at: new Date(CURRENT_UPDATED_AT) },
      data: {
        conditions: { patient_status: 'active' },
        evidence_requirements: { required_documents: ['visit_record'] },
      },
    });
  });

  it('returns no-store 409 before PATCH side effects when expected_updated_at is stale', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(409);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_billing_rule',
        expected_updated_at: CURRENT_UPDATED_AT,
        current_updated_at: '2026-06-19T00:01:00.000Z',
      },
    });
    expect(billingRuleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns no-store 409 when a concurrent PATCH wins the guarded claim', async () => {
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });
    billingRuleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(409);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_billing_rule',
        expected_updated_at: CURRENT_UPDATED_AT,
        current_updated_at: '2026-06-19T00:01:00.000Z',
      },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PATCH update throws unexpectedly', async () => {
    const rawMessage = 'raw patch billing rule failure';
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleUpdateManyMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response as Response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'billing_rules_id_patch_unhandled_error',
        route: '/api/billing-rules/:id',
        status: 500,
      }),
      expect.any(Error),
    );
  });

  it('forbids deleting system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(403);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(billingRuleDeleteMock).not.toHaveBeenCalled();
  });

  it('rejects blank DELETE route ids before rule lookup or delete', async () => {
    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      message: '算定ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth rejection for DELETE before rule lookup or delete', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(403);
    expectNoStore(resolvedResponse);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before DELETE lookup or delete', async () => {
    const response = await DELETE(createDeleteRequestWithoutExpectedUpdatedAt(), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingRuleFindFirstMock).not.toHaveBeenCalled();
    expect(billingRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  it('deletes custom rules with an audit entry', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      billing_scope: 'custom',
      rule_type: 'addition',
      service_type: 'medical_home_visit',
      name: '任意加算',
      amount: 10,
      is_active: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectNoStore(resolvedResponse);
    const body = await resolvedResponse.json();
    expect(body).toEqual({ data: { id: 'rule_1' } });
    expect(body).not.toHaveProperty('message');
    expect(billingRuleDeleteManyMock).toHaveBeenCalledWith({
      where: { id: 'rule_1', org_id: 'org_1', updated_at: new Date(CURRENT_UPDATED_AT) },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'billing_rule_deleted',
          target_type: 'BillingRule',
          target_id: 'rule_1',
        }),
      }),
    );
  });

  it('returns no-store 409 before DELETE side effects when expected_updated_at is stale', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(409);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_billing_rule',
        expected_updated_at: CURRENT_UPDATED_AT,
        current_updated_at: '2026-06-19T00:01:00.000Z',
      },
    });
    expect(billingRuleDeleteManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns no-store 409 when a concurrent DELETE wins the guarded claim', async () => {
    billingRuleFindFirstMock.mockResolvedValueOnce({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleFindFirstMock.mockResolvedValueOnce({
      updated_at: new Date('2026-06-19T00:01:00.000Z'),
    });
    billingRuleDeleteManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(409);
    expectNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_billing_rule',
        expected_updated_at: CURRENT_UPDATED_AT,
        current_updated_at: '2026-06-19T00:01:00.000Z',
      },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when DELETE throws unexpectedly', async () => {
    const rawMessage = 'raw delete billing rule failure';
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    billingRuleDeleteManyMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response as Response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'billing_rules_id_delete_unhandled_error',
        route: '/api/billing-rules/:id',
        status: 500,
      }),
      expect.any(Error),
    );
  });
});
