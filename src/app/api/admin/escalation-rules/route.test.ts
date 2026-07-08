import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  escalationRuleCountMock,
  escalationRuleFindManyMock,
  escalationRuleCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  escalationRuleCountMock: vi.fn(),
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
      count: escalationRuleCountMock,
      findMany: escalationRuleFindManyMock,
      create: escalationRuleCreateMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET, POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(method: 'GET' | 'POST', headers?: Record<string, string>, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/escalation-rules', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createGetRequest(search = '', headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/admin/escalation-rules${search}`, {
    method: 'GET',
    headers,
  });
}

function createMalformedJsonPostRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/escalation-rules', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: '{bad json',
  });
}

describe('/api/admin/escalation-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    escalationRuleCountMock.mockResolvedValue(0);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        escalationRule: {
          create: escalationRuleCreateMock,
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('returns escalation rules for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleCountMock.mockResolvedValue(1);
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

    const response = await GET(
      createGetRequest('?limit=5', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'meta']);
    expect(body).toEqual({
      data: [
        {
          id: 'rule_1',
          trigger_type: 'workflow_exception_unresolved',
          condition: { threshold_hours: 12, severity: 'high' },
          action: 'admin_alert',
          notify_role: 'admin',
          is_active: true,
          created_at: '2026-03-28T00:00:00.000Z',
          updated_at: '2026-03-28T01:00:00.000Z',
        },
      ],
      meta: {
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'escalation_rules',
        filters_applied: {},
        limit: 5,
      },
    });
    expect(escalationRuleCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(escalationRuleFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
      take: 5,
    });
  });

  it('returns counted metadata when the bounded escalation rule list is truncated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleCountMock.mockResolvedValue(3);
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

    const response = await GET(
      createGetRequest('?limit=1', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        total_count: 3,
        visible_count: 1,
        hidden_count: 2,
        truncated: true,
        count_basis: 'escalation_rules',
        filters_applied: {},
        limit: 1,
      },
    });
  });

  it('uses a default list bound and clamps overly large limits', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    escalationRuleFindManyMock.mockResolvedValue([]);

    const defaultResponse = await GET(
      createGetRequest('', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );
    if (!defaultResponse) throw new Error('defaultResponse is required');
    expect(defaultResponse.status).toBe(200);
    expect(escalationRuleFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );

    const clampedResponse = await GET(
      createGetRequest('?limit=9999', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );
    if (!clampedResponse) throw new Error('clampedResponse is required');
    expect(clampedResponse.status).toBe(200);
    expect(escalationRuleFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
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
          condition: { threshold_hours: ' 24 ', severity: 'high', status_in: ['pending'] },
          action: 'conference_task',
          notify_role: 'manager',
          is_active: true,
        },
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(escalationRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        trigger_type: 'billing_review_stalled',
        condition: { threshold_hours: 24, severity: 'high', status_in: ['pending'] },
        action: 'conference_task',
        notify_role: 'manager',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        escalationRule: expect.any(Object),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      expect.objectContaining({
        action: 'escalation_rule_created',
        targetType: 'EscalationRule',
        targetId: 'rule_2',
        changes: expect.objectContaining({
          trigger_type: 'billing_review_stalled',
          condition: { threshold_hours: 24, severity: 'high' },
          action: 'conference_task',
          notify_role: 'manager',
          is_active: true,
        }),
      }),
    );
  });

  it.each(['1e2', '10.0', '6abc', ' ', true, 0, 721])(
    'rejects malformed threshold_hours=%s before writing the escalation rule',
    async (thresholdHours) => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

      const response = await POST(
        createRequest(
          'POST',
          { 'x-org-id': 'org_1' },
          {
            trigger_type: 'billing_review_stalled',
            condition: { threshold_hours: thresholdHours, severity: 'high' },
            action: 'conference_task',
            notify_role: 'manager',
          },
        ),
        emptyRouteContext,
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
      });
      expect(escalationRuleCreateMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    },
  );

  it('rejects non-object create payloads before writing the escalation rule', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createRequest('POST', { 'x-org-id': 'org_1' }, []),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(escalationRuleCreateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before writing the escalation rule', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createMalformedJsonPostRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(escalationRuleCreateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
