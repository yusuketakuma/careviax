import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  notificationRuleFindFirstMock,
  notificationRuleUpdateMock,
  notificationRuleDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleFindFirstMock: vi.fn(),
  notificationRuleUpdateMock: vi.fn(),
  notificationRuleDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

describe('/api/notification-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    notificationRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      enabled: true,
    });
    notificationRuleUpdateMock.mockResolvedValue({
      id: 'rule_1',
      enabled: false,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          findFirst: notificationRuleFindFirstMock,
          update: notificationRuleUpdateMock,
          delete: notificationRuleDeleteMock,
        },
      }),
    );
  });

  it('returns a notification rule by id', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('updates a notification rule', async () => {
    const response = (await PATCH({
      json: async () => ({
        enabled: false,
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(notificationRuleUpdateMock).toHaveBeenCalled();
  });

  it('deletes a notification rule', async () => {
    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(notificationRuleDeleteMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
    });
  });
});
