import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

import { DELETE, PATCH } from './route';

function createRequest(body?: unknown) {
  return {
    headers: {
      get: () => 'org_1',
    },
    json: async () => body,
  } as unknown as NextRequest;
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
      })
    );
  });

  it('blocks non-active field changes for system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
    });

    const response = await PATCH(
      createRequest({ name: '変更したい' }),
      { params: Promise.resolve({ id: 'rule_1' }) }
    );

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

    const response = await PATCH(
      createRequest({ is_active: false }),
      { params: Promise.resolve({ id: 'rule_1' }) }
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(billingRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: { is_active: false },
    });
  });

  it('forbids deleting system rules', async () => {
    billingRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      is_system: true,
    });

    const response = await DELETE(
      createRequest(),
      { params: Promise.resolve({ id: 'rule_1' }) }
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(403);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(billingRuleDeleteMock).not.toHaveBeenCalled();
  });
});
