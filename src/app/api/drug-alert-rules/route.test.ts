import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  drugAlertRuleFindManyMock,
  drugAlertRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
  drugAlertRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/drug-alert-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    drugAlertRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    drugAlertRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        drugAlertRule: {
          findMany: drugAlertRuleFindManyMock,
          create: drugAlertRuleCreateMock,
        },
      }),
    );
  });

  it('lists alert rules', async () => {
    const response = (await GET({
      url: 'http://localhost/api/drug-alert-rules',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    expect(drugAlertRuleFindManyMock).toHaveBeenCalled();
  });

  it('creates an alert rule', async () => {
    const response = (await POST({
      json: async () => ({
        alert_type: 'interaction',
        condition: {},
        severity: 'warning',
        message: '併用禁忌を確認',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(drugAlertRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alert_type: 'interaction',
        severity: 'warning',
        message: '併用禁忌を確認',
        is_active: true,
      }),
    });
  });
});
