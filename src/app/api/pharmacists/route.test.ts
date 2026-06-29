import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  membershipFindManyMock,
  visitScheduleGroupByMock,
  userFindFirstMock,
  validateOrgReferencesMock,
  inviteCognitoUserMock,
  deleteCognitoUserMock,
  withOrgContextMock,
  userCreateMock,
  membershipCreateMock,
  auditLogCreateMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  visitScheduleGroupByMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  inviteCognitoUserMock: vi.fn(),
  deleteCognitoUserMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  userCreateMock: vi.fn(),
  membershipCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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
  deleteCognitoUser: deleteCognitoUserMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacists', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacists', {
    method: 'POST',
    body: '{',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/pharmacists${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

afterEach(() => {
  vi.useRealTimers();
});

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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        membership: {
          findMany: membershipFindManyMock,
        },
        visitSchedule: {
          groupBy: visitScheduleGroupByMock,
        },
      }),
    );
  });

  it('blocks collaborator mode for non-admin roles', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(createGetRequest('?include_collaborators=true'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it.each([
    ['', 500],
    ['?limit=5', 5],
    ['?limit=9999', 500],
    ['?limit=0', 1],
    ['?limit=abc', 500],
  ])('bounds membership list limit for query "%s"', async (query, expectedTake) => {
    const response = await GET(createGetRequest(query));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('uses explicit RLS request context for staff listing and monthly counts', async () => {
    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
      }),
    });
  });

  it.each(['?site_id=', '?site_id=%20%20'])(
    'rejects blank site_id filters before listing memberships for query "%s"',
    async (query) => {
      const response = await GET(createGetRequest(query));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'クエリパラメータが不正です',
        details: {
          site_id: ['site_id が不正です'],
        },
      });
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(visitScheduleGroupByMock).not.toHaveBeenCalled();
    },
  );

  it('trims valid site_id filters before listing memberships', async () => {
    const response = await GET(createGetRequest('?site_id=%20site_1%20'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          site_id: 'site_1',
        }),
      }),
    );
  });

  it('includes suspended staff in collaborator mode for admin management screens', async () => {
    const response = await GET(createGetRequest('?include_collaborators=true'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
        take: 500,
      }),
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

  it('returns schedule switcher fields used by the dashboard', async () => {
    visitScheduleGroupByMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'user_1',
        _count: {
          _all: 7,
        },
      },
    ]);

    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(visitScheduleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pharmacist_id: { in: ['user_1'] },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'user_1',
          name: '停止 ユーザー',
          site_id: 'site_1',
          site_name: '本店',
          monthly_visit_count: 7,
        }),
      ],
    });
  });

  it('uses the Japan business month for monthly visit counts near UTC day boundaries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z'));

    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: {
            gte: new Date('2026-07-01T00:00:00.000Z'),
            lt: new Date('2026-08-01T00:00:00.000Z'),
          },
        }),
      }),
    );
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
    expect(response.status).toBe(200);
    expectNoStore(response);
    const payload = await response.json();
    expect(payload).toMatchObject({
      data: [expect.objectContaining({ id: 'user_1', name: '重複 ユーザー' })],
    });
    expect(payload.data).toHaveLength(1);
  });

  it('returns a sanitized no-store 500 when pharmacist listing fails unexpectedly', async () => {
    membershipFindManyMock.mockRejectedValueOnce(new Error('raw pharmacist staff secret'));

    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw pharmacist staff secret');
    expect(loggerErrorMock).toHaveBeenCalledWith('pharmacists_get_unhandled_error', undefined, {
      event: 'pharmacists_get_unhandled_error',
      route: '/api/pharmacists',
      method: 'GET',
      status: 500,
      error_name: 'Error',
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('raw pharmacist staff secret');
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
    deleteCognitoUserMock.mockResolvedValue(undefined);
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

  it('returns no-store auth failures before parsing body or inviting Cognito users', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before reference checks or invites', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before reference checks or invites', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed phone numbers before reference checks or invites', async () => {
    const response = await POST(
      createRequest({
        name: '不正 電話',
        name_kana: 'フセイ デンワ',
        email: 'bad-phone@example.com',
        phone: '090-ABCD-1234',
        role: 'external_viewer',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        phone: ['電話番号形式が不正です'],
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
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
    expectNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: undefined,
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
      }),
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

  it('creates an operational pharmacist with visit settings', async () => {
    const response = await POST(
      createRequest({
        name: '訪問 薬剤師',
        name_kana: 'ホウモン ヤクザイシ',
        email: 'visit@example.com',
        phone: ' 090-1234-5678 ',
        role: 'pharmacist',
        site_id: 'site_1',
        max_daily_visits: 6,
        max_weekly_visits: 24,
        max_travel_minutes: 45,
        can_accept_emergency: true,
        visit_specialties: ['terminal_care'],
        coverage_area: ['新宿区'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'visit@example.com',
      name: '訪問 薬剤師',
      phone: '090-1234-5678',
      phosTenantId: 'org_1',
      phosRole: 'PHARMACIST',
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'visit@example.com',
        phone: '090-1234-5678',
        max_daily_visits: 6,
        max_weekly_visits: 24,
        max_travel_minutes: 45,
        can_accept_emergency: true,
        visit_specialties: ['terminal_care'],
        coverage_area: ['新宿区'],
      }),
    });
  });

  it('deletes the invited Cognito user when database creation fails', async () => {
    userCreateMock.mockRejectedValueOnce(new Error('database write failed'));

    const response = await POST(
      createRequest({
        name: '失敗 薬剤師',
        name_kana: 'シッパイ ヤクザイシ',
        email: 'rollback@example.com',
        role: 'external_viewer',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'rollback@example.com',
      name: '失敗 薬剤師',
      phone: undefined,
      phosTenantId: 'org_1',
      phosRole: null,
    });
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('external@example.com');
    await expect(response.json()).resolves.toMatchObject({
      message: '薬剤師情報の保存に失敗しました',
    });
    expect(membershipCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('reports administrator follow-up when Cognito cleanup also fails', async () => {
    userCreateMock.mockRejectedValueOnce(new Error('database write failed'));
    deleteCognitoUserMock.mockRejectedValueOnce(new Error('delete failed'));

    const response = await POST(
      createRequest({
        name: '削除失敗 薬剤師',
        name_kana: 'サクジョシッパイ ヤクザイシ',
        email: 'cleanup-failed@example.com',
        role: 'external_viewer',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('external@example.com');
    await expect(response.json()).resolves.toMatchObject({
      message:
        '薬剤師情報の保存に失敗しました。Cognito ユーザーの削除に失敗したため管理者確認が必要です',
    });
    expect(membershipCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
