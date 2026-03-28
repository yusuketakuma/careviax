import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  userFindFirstMock,
  validateOrgReferencesMock,
  inviteCognitoUserMock,
  withOrgContextMock,
  userCreateMock,
  membershipCreateMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  inviteCognitoUserMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  userCreateMock: vi.fn(),
  membershipCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findFirst: userFindFirstMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/cognito-admin', () => ({
  inviteCognitoUser: inviteCognitoUserMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => (key === 'x-org-id' ? 'org_1' : null),
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/pharmacists POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    userFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito-sub-1',
      username: 'external@example.com',
    });
    userCreateMock.mockResolvedValue({
      id: 'user_1',
      email: 'external@example.com',
    });
    membershipCreateMock.mockResolvedValue({ id: 'membership_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        user: {
          create: userCreateMock,
        },
        membership: {
          create: membershipCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('creates an external viewer without a site assignment', async () => {
    const response = await POST(
      createRequest({
        name: '地域連携 共有先',
        name_kana: 'チイキレンケイ キョウユウサキ',
        email: 'external@example.com',
        role: 'external_viewer',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: undefined,
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '地域連携 共有先',
        max_daily_visits: null,
        max_weekly_visits: null,
        max_travel_minutes: null,
        can_accept_emergency: false,
        visit_specialties: [],
        coverage_area: [],
      }),
    });
    expect(membershipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        site_id: null,
        role: 'external_viewer',
        can_dispense: false,
        can_set: false,
        can_audit_dispense: false,
        can_audit_set: false,
      }),
    });
  });
});
