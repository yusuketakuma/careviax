import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requirePlatformOperatorMock,
  getActiveSessionMock,
  withBreakGlassOrgContextMock,
  auditLogFindManyMock,
} = vi.hoisted(() => ({
  requirePlatformOperatorMock: vi.fn(),
  getActiveSessionMock: vi.fn(),
  withBreakGlassOrgContextMock: vi.fn(),
  auditLogFindManyMock: vi.fn(),
}));

vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: requirePlatformOperatorMock,
}));

vi.mock('@/lib/platform/break-glass', () => ({
  getActiveBreakGlassSession: getActiveSessionMock,
  withBreakGlassOrgContext: withBreakGlassOrgContextMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const operator = {
  operatorId: 'operator_1',
  userId: 'user_1',
  email: 'operator@example.invalid',
  role: 'platform_operator',
};
const session = {
  id: 'bg_1',
  operator_id: 'operator_1',
  target_org_id: 'org_1',
  status: 'active',
  scope: 'read_only',
};

function createRequest() {
  return new NextRequest('http://localhost/api/platform/tenants/org_1/audit');
}

function routeContext(orgId = 'org_1') {
  return { params: Promise.resolve({ orgId }) };
}

describe('GET /api/platform/tenants/[orgId]/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    getActiveSessionMock.mockResolvedValue(session);
    auditLogFindManyMock.mockResolvedValue([
      {
        id: 'audit_1',
        actor_id: 'user_1',
        action: 'break_glass_read',
        target_type: 'patient',
        target_id: 'patient_1',
        changes: { reason: '障害調査のため確認します' },
        ip_address: '127.0.0.1',
        created_at: new Date('2026-07-10T06:00:00.000Z'),
      },
    ]);
    withBreakGlassOrgContextMock.mockImplementation(
      async (_operator, _session, _access, readAuditRows) =>
        readAuditRows({ auditLog: { findMany: auditLogFindManyMock } }),
    );
  });

  it('does not inspect sessions or audit rows when the platform guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(getActiveSessionMock).not.toHaveBeenCalled();
    expect(withBreakGlassOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogFindManyMock).not.toHaveBeenCalled();
  });

  it('fails closed without entering tenant context when there is no active session', async () => {
    getActiveSessionMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext('org_2'));

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getActiveSessionMock).toHaveBeenCalledWith('operator_1', 'org_2');
    expect(withBreakGlassOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogFindManyMock).not.toHaveBeenCalled();
  });

  it('reads a bounded tenant audit page inside the active break-glass context', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(getActiveSessionMock).toHaveBeenCalledWith('operator_1', 'org_1');
    expect(withBreakGlassOrgContextMock).toHaveBeenCalledWith(
      operator,
      session,
      {
        targetType: 'break_glass_audit',
        targetId: 'org_1',
        metadata: { view: 'audit' },
      },
      expect.any(Function),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith({
      where: {
        action: {
          in: [
            'break_glass_activate',
            'break_glass_revoke',
            'break_glass_read',
            'break_glass_write',
          ],
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        actor_id: true,
        action: true,
        target_type: true,
        target_id: true,
        changes: true,
        ip_address: true,
        created_at: true,
      },
    });
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'audit_1',
          actor_id: 'user_1',
          action: 'break_glass_read',
          target_type: 'patient',
          target_id: 'patient_1',
          changes: { reason: '障害調査のため確認します' },
          ip_address: '127.0.0.1',
          created_at: '2026-07-10T06:00:00.000Z',
        },
      ],
      meta: { limit: 100, has_more: false },
    });
  });
});
