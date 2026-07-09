import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  getAuthAccessTokenMock,
  userUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
  globalSignOutWithAccessTokenMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  userUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  globalSignOutWithAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      update: userUpdateMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  globalSignOutWithAccessToken: globalSignOutWithAccessTokenMock,
}));

import { POST } from './route';

describe('/api/me/logout-all POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: { id: 'user_1' },
    });
    getAuthAccessTokenMock.mockResolvedValue('access-token');
    userUpdateMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_1',
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    globalSignOutWithAccessTokenMock.mockResolvedValue(undefined);
  });

  it('increments the session version, records an audit event, and revokes Cognito sessions', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/me/logout-all', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { ok: true } });
    expect(body).not.toHaveProperty('ok');
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: {
        id: true,
        org_id: true,
      },
      data: {
        session_version: {
          increment: 1,
        },
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'logout_all',
        target_type: 'session',
        target_id: 'user_1',
        changes: {
          scope: 'all_devices',
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
    expect(globalSignOutWithAccessTokenMock).toHaveBeenCalledWith('access-token');
  });

  it('returns 401 when the session is missing', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/me/logout-all', { method: 'POST' }),
    );

    expect(response.status).toBe(401);
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
