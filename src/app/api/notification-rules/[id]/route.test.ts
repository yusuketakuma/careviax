import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(init?: NextRequestInit) {
  return new NextRequest('http://localhost/api/notification-rules/rule_1', init);
}

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
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('updates a notification rule', async () => {
    const response = (await PATCH(
      createRequest({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          recipients: { roles: ['admin'], user_ids: ['user_1'] },
          conditions: {
            throttle_minutes: 30,
            fallback: null,
            levels: ['high', null],
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'rule_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(notificationRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: expect.objectContaining({
        enabled: false,
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: {
          throttle_minutes: 30,
          fallback: null,
          levels: ['high', null],
        },
      }),
    });
  });

  it('deletes a notification rule', async () => {
    const response = (await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(notificationRuleDeleteMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
    });
  });
});
