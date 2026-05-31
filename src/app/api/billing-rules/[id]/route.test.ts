import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  billingRuleFindFirstMock,
  billingRuleUpdateMock,
  billingRuleDeleteMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  billingRuleFindFirstMock: vi.fn(),
  billingRuleUpdateMock: vi.fn(),
  billingRuleDeleteMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(method: 'DELETE' | 'GET' | 'PATCH', body?: unknown) {
  const init: NextRequestInit = {
    method,
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/billing-rules/rule_1', init);
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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingRule: {
          findFirst: billingRuleFindFirstMock,
          update: billingRuleUpdateMock,
          delete: billingRuleDeleteMock,
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
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      id: 'rule_1',
      conditions: {},
      evidence_requirements: {},
    });
  });

  it('blocks non-active field changes for system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
    });

    const response = await PATCH(createRequest('PATCH', { name: '変更したい' }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(400);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(billingRuleUpdateMock).not.toHaveBeenCalled();
  });

  it('allows active toggle for system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
    });

    const response = await PATCH(createRequest('PATCH', { is_active: false }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(billingRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: { is_active: false },
    });
  });

  it('updates custom rule JSON fields', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: false,
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
    expect(billingRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: {
        conditions: { patient_status: 'active' },
        evidence_requirements: { required_documents: ['visit_record'] },
      },
    });
  });

  it('forbids deleting system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
    });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(403);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(billingRuleDeleteMock).not.toHaveBeenCalled();
  });
});
