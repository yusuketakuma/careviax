import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  membershipFindManyMock,
  visitScheduleGroupByMock,
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
  membershipFindManyMock: vi.fn(),
  visitScheduleGroupByMock: vi.fn(),
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
      findMany: membershipFindManyMock,
    },
    visitSchedule: {
      groupBy: visitScheduleGroupByMock,
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

import { GET, POST } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/pharmacists',
    headers: {
      get: (key: string) => (key === 'x-org-id' ? 'org_1' : null),
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function createGetRequest(query = '') {
  return {
    url: `http://localhost/api/pharmacists${query}`,
    headers: {
      get: (key: string) => (key === 'x-org-id' ? 'org_1' : null),
    },
  } as unknown as NextRequest;
}

describe('/api/pharmacists GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    membershipFindManyMock.mockResolvedValue([
      {
        site_id: 'site_1',
        role: 'pharmacist',
        can_dispense: true,
        can_audit_dispense: false,
        can_set: true,
        can_audit_set: false,
        user: {
          id: 'user_1',
          cognito_username: 'staff@example.com',
          name: '停止 ユーザー',
          name_kana: 'テイシ ユーザー',
          email: 'staff@example.com',
          phone: null,
          is_active: false,
          account_status: 'suspended',
          invited_at: null,
          last_invited_at: null,
          activated_at: null,
          deactivated_at: new Date('2026-03-31T00:00:00Z'),
          deactivation_reason: '長期休職',
          updated_at: new Date('2026-03-31T00:00:00Z'),
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: false,
          visit_specialties: [],
          coverage_area: [],
          credentials: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
    ]);
    visitScheduleGroupByMock.mockResolvedValue([]);
  });

  it('blocks collaborator mode for non-admin roles', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(createGetRequest('?include_collaborators=true'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('includes suspended staff in collaborator mode for admin management screens', async () => {
    const response = await GET(createGetRequest('?include_collaborators=true'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
      })
    );
    expect(membershipFindManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('is_active');
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'user_1',
          account_status: 'suspended',
          deactivation_reason: '長期休職',
        }),
      ],
    });
  });

  it('dedupes collaborator rows by user id', async () => {
    membershipFindManyMock.mockResolvedValueOnce([
      {
        site_id: 'site_1',
        role: 'pharmacist',
        can_dispense: true,
        can_audit_dispense: false,
        can_set: true,
        can_audit_set: false,
        user: {
          id: 'user_1',
          cognito_username: 'staff@example.com',
          name: '重複 ユーザー',
          name_kana: 'チョウフク ユーザー',
          email: 'staff@example.com',
          phone: null,
          is_active: true,
          account_status: 'active',
          invited_at: null,
          last_invited_at: null,
          activated_at: new Date('2026-03-31T00:00:00Z'),
          deactivated_at: null,
          deactivation_reason: null,
          updated_at: new Date('2026-03-31T00:00:00Z'),
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: false,
          visit_specialties: [],
          coverage_area: [],
          credentials: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
      {
        site_id: 'site_2',
        role: 'admin',
        can_dispense: true,
        can_audit_dispense: true,
        can_set: true,
        can_audit_set: true,
        user: {
          id: 'user_1',
          cognito_username: 'staff@example.com',
          name: '重複 ユーザー',
          name_kana: 'チョウフク ユーザー',
          email: 'staff@example.com',
          phone: null,
          is_active: true,
          account_status: 'active',
          invited_at: null,
          last_invited_at: null,
          activated_at: new Date('2026-03-31T00:00:00Z'),
          deactivated_at: null,
          deactivation_reason: null,
          updated_at: new Date('2026-03-31T00:00:00Z'),
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: false,
          visit_specialties: [],
          coverage_area: [],
          credentials: [],
        },
        site: {
          id: 'site_2',
          name: '支店',
        },
      },
    ]);

    const response = await GET(createGetRequest('?include_collaborators=true'));

    if (!response) throw new Error('response is required');
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: [expect.objectContaining({ id: 'user_1', name: '重複 ユーザー' })],
    });
    expect(payload.data).toHaveLength(1);
  });
});

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
