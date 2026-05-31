import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  escalationRuleFindFirstMock,
  escalationRuleUpdateMock,
  escalationRuleDeleteMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  escalationRuleFindFirstMock: vi.fn(),
  escalationRuleUpdateMock: vi.fn(),
  escalationRuleDeleteMock: vi.fn(),
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
      findFirst: escalationRuleFindFirstMock,
      update: escalationRuleUpdateMock,
      delete: escalationRuleDeleteMock,
    },
  },
}));

import { DELETE, PATCH } from './route';

function createRequest(method: 'PATCH' | 'DELETE', headers?: Record<string, string>, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/escalation-rules/rule_1', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/admin/escalation-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates an escalation rule', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
    });
    escalationRuleUpdateMock.mockResolvedValue({
      id: 'rule_1',
      trigger_type: 'report_delivery_failed',
      condition: { threshold_hours: 6, severity: 'urgent' },
      action: 'admin_alert',
      notify_role: 'admin',
      is_active: false,
      created_at: new Date('2026-03-28T00:00:00Z'),
      updated_at: new Date('2026-03-28T02:00:00Z'),
    });

    const response = await PATCH(
      createRequest('PATCH', { 'x-org-id': 'org_1' }, {
        is_active: false,
        condition: { threshold_hours: '6', severity: 'urgent', status_in: ['open'] },
      }),
      { params: Promise.resolve({ id: 'rule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(escalationRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: {
        is_active: false,
        condition: { threshold_hours: 6, severity: 'urgent', status_in: ['open'] },
      },
    });
  });

  it('deletes an escalation rule', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
    });
    escalationRuleDeleteMock.mockResolvedValue({ id: 'rule_1' });

    const response = await DELETE(
      createRequest('DELETE', { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'rule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(escalationRuleDeleteMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
    });
  });
});
