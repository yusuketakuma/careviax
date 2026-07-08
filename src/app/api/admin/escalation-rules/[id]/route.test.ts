import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  escalationRuleFindFirstMock,
  escalationRuleUpdateMock,
  escalationRuleDeleteMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { DELETE, PATCH } from './route';

function createRequest(
  method: 'PATCH' | 'DELETE',
  headers?: Record<string, string>,
  body?: unknown,
) {
  return new NextRequest('http://localhost/api/admin/escalation-rules/rule_1', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/escalation-rules/rule_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: '{bad json',
  });
}

describe('/api/admin/escalation-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        escalationRule: {
          findFirst: escalationRuleFindFirstMock,
          update: escalationRuleUpdateMock,
          delete: escalationRuleDeleteMock,
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    escalationRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      org_id: 'org_1',
      trigger_type: 'workflow_exception_unresolved',
      condition: { threshold_hours: 12, severity: 'high' },
      action: 'in_app_notification',
      notify_role: 'admin',
      is_active: true,
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
    escalationRuleDeleteMock.mockResolvedValue({ id: 'rule_1' });
  });

  it('updates an escalation rule', async () => {
    const response = await PATCH(
      createRequest(
        'PATCH',
        { 'x-org-id': 'org_1' },
        {
          is_active: false,
          condition: { threshold_hours: ' 6 ', severity: 'urgent', status_in: ['open'] },
        },
      ),
      { params: Promise.resolve({ id: '  rule_1  ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(escalationRuleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'rule_1', org_id: 'org_1' },
    });
    expect(escalationRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: {
        is_active: false,
        condition: { threshold_hours: 6, severity: 'urgent', status_in: ['open'] },
      },
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
        action: 'escalation_rule_updated',
        targetType: 'EscalationRule',
        targetId: 'rule_1',
        changes: expect.objectContaining({
          previous: expect.objectContaining({
            trigger_type: 'workflow_exception_unresolved',
            condition: { threshold_hours: 12, severity: 'high' },
            action: 'in_app_notification',
            notify_role: 'admin',
            is_active: true,
          }),
          current: expect.objectContaining({
            trigger_type: 'report_delivery_failed',
            condition: { threshold_hours: 6, severity: 'urgent' },
            action: 'admin_alert',
            notify_role: 'admin',
            is_active: false,
          }),
        }),
      }),
    );
  });

  it.each(['1e2', '10.0', '6abc', ' ', true, 0, 721])(
    'rejects malformed threshold_hours=%s before loading the escalation rule',
    async (thresholdHours) => {
      const response = await PATCH(
        createRequest(
          'PATCH',
          { 'x-org-id': 'org_1' },
          {
            condition: { threshold_hours: thresholdHours, severity: 'urgent' },
          },
        ),
        { params: Promise.resolve({ id: 'rule_1' }) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
      });
      expect(escalationRuleFindFirstMock).not.toHaveBeenCalled();
      expect(escalationRuleUpdateMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    },
  );

  it('rejects blank escalation rule ids before parsing update payloads', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'エスカレーションルールIDが不正です',
    });
    expect(escalationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(escalationRuleUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before loading the escalation rule', async () => {
    const response = await PATCH(createRequest('PATCH', { 'x-org-id': 'org_1' }, []), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(escalationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(escalationRuleUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the escalation rule', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(escalationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(escalationRuleUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('deletes an escalation rule', async () => {
    const response = await DELETE(createRequest('DELETE', { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'rule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toEqual({
      data: { id: 'rule_1' },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(escalationRuleDeleteMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
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
        action: 'escalation_rule_deleted',
        targetType: 'EscalationRule',
        targetId: 'rule_1',
        changes: expect.objectContaining({
          trigger_type: 'workflow_exception_unresolved',
          condition: { threshold_hours: 12, severity: 'high' },
          action: 'in_app_notification',
          notify_role: 'admin',
          is_active: true,
        }),
      }),
    );
  });

  it('rejects blank escalation rule ids before delete lookups', async () => {
    const response = await DELETE(createRequest('DELETE', { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'エスカレーションルールIDが不正です',
    });
    expect(escalationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(escalationRuleDeleteMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
