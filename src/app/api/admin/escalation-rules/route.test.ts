import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  escalationRuleFindManyMock,
  escalationRuleCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  escalationRuleFindManyMock: vi.fn(),
  escalationRuleCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    escalationRule: {
      findMany: escalationRuleFindManyMock,
      create: escalationRuleCreateMock,
    },
  },
}));

import { GET, POST } from './route';

function createRequest(method: 'GET' | 'POST', headers?: Record<string, string>, body?: unknown) {
  return {
    method,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/admin/escalation-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns escalation rules for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_1',
        trigger_type: 'workflow_exception_unresolved',
        condition: { threshold_hours: 12, severity: 'high' },
        action: 'admin_alert',
        notify_role: 'admin',
        is_active: true,
        created_at: new Date('2026-03-28T00:00:00Z'),
        updated_at: new Date('2026-03-28T01:00:00Z'),
      },
    ]);

    const response = await GET(createRequest('GET', { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'rule_1',
          trigger_type: 'workflow_exception_unresolved',
          action: 'admin_alert',
          notify_role: 'admin',
          is_active: true,
        }),
      ],
    });
  });

  it('creates an escalation rule', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleCreateMock.mockResolvedValue({
      id: 'rule_2',
      trigger_type: 'billing_review_stalled',
      condition: { threshold_hours: 24, severity: 'high' },
      action: 'conference_task',
      notify_role: 'manager',
      is_active: true,
      created_at: new Date('2026-03-28T00:00:00Z'),
      updated_at: new Date('2026-03-28T00:00:00Z'),
    });

    const response = await POST(
      createRequest(
        'POST',
        { 'x-org-id': 'org_1' },
        {
          trigger_type: 'billing_review_stalled',
          condition: { threshold_hours: 24, severity: 'high' },
          action: 'conference_task',
          notify_role: 'manager',
          is_active: true,
        }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(escalationRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        trigger_type: 'billing_review_stalled',
        action: 'conference_task',
        notify_role: 'manager',
      }),
    });
  });
});
