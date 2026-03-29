import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  notificationRuleFindManyMock,
  notificationRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleFindManyMock: vi.fn(),
  notificationRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/notification-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    notificationRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    notificationRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          findMany: notificationRuleFindManyMock,
          create: notificationRuleCreateMock,
        },
      }),
    );
  });

  it('lists notification rules', async () => {
    const response = (await GET({} as NextRequest))!;

    expect(response.status).toBe(200);
    expect(notificationRuleFindManyMock).toHaveBeenCalled();
  });

  it('creates a notification rule', async () => {
    const response = (await POST({
      json: async () => ({
        event_type: 'visit_schedule_created',
        channel: 'in_app',
        recipients: { roles: ['admin'] },
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(notificationRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        event_type: 'visit_schedule_created',
        channel: 'in_app',
      }),
    });
  });
});
