import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  denyAuthMock,
  registeredAuthOptions,
  organizationFindFirstMock,
  membershipFindFirstMock,
  pharmacySiteFindFirstMock,
  settingFindFirstMock,
  settingCreateMock,
  settingUpdateMock,
  auditLogCountMock,
  withOrgContextMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  denyAuthMock: vi.fn(),
  // 登録時(import 時)の options を保持する。vi.clearAllMocks では消えない素の配列。
  registeredAuthOptions: [] as unknown[],
  organizationFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  settingFindFirstMock: vi.fn(),
  settingCreateMock: vi.fn(),
  settingUpdateMock: vi.fn(),
  auditLogCountMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown, options?: unknown) => {
    registeredAuthOptions.push(options);
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
      if (denyAuthMock()) {
        return new Response(
          JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '運用ポリシーの更新権限がありません' }),
          { status: 403 },
        );
      }
      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findFirst: organizationFindFirstMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    setting: {
      findFirst: settingFindFirstMock,
    },
    auditLog: {
      count: auditLogCountMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/settings/operational-policy', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/settings/operational-policy PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    denyAuthMock.mockReturnValue(false);
    organizationFindFirstMock.mockResolvedValue({ name: 'PH-OS薬局' });
    membershipFindFirstMock.mockResolvedValue({ site: { name: '本店' } });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
    settingFindFirstMock.mockResolvedValue(null);
    auditLogCountMock.mockResolvedValue(0);
    settingCreateMock.mockResolvedValue({ id: 'setting_1' });
    settingUpdateMock.mockResolvedValue({ id: 'setting_1' });
    createAuditLogEntryMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        setting: {
          create: settingCreateMock,
          update: settingUpdateMock,
        },
      }),
    );
  });

  it('requires admin permission and returns 403 when permission is denied', async () => {
    denyAuthMock.mockReturnValue(true);

    const response = await PATCH(createPatchRequest({ quiet_hours: false }), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    // PATCH は canAdmin 権限を要求して登録される(import 時に記録した options を検証)
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canAdmin',
      message: '運用ポリシーの更新権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('records an operational-policy update audit log entry on success', async () => {
    const response = await PATCH(createPatchRequest({ quiet_hours: false }), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(200);
    expect(settingCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: 'organization',
          scope_id: 'org_1',
          key: 'operational_policy',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'operational_policy_updated',
        targetType: 'Setting',
        targetId: 'operational_policy',
        changes: expect.objectContaining({
          changed_keys: expect.arrayContaining(['quiet_hours']),
        }),
      }),
    );
  });
});
