import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  userFindFirstMock,
  validateOrgReferencesMock,
  updateCognitoUserProfileMock,
  disableCognitoUserMock,
  userUpdateMock,
  membershipUpdateMock,
  membershipUpdateManyMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  updateCognitoUserProfileMock: vi.fn(),
  disableCognitoUserMock: vi.fn(),
  userUpdateMock: vi.fn(),
  membershipUpdateMock: vi.fn(),
  membershipUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findFirst: userFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/cognito-admin', () => ({
  updateCognitoUserProfile: updateCognitoUserProfileMock,
  disableCognitoUser: disableCognitoUserMock,
  enableCognitoUser: vi.fn(),
  resendCognitoInvite: vi.fn(),
}));

import { PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/pharmacists/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
      },
    });
    userFindFirstMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_1',
      cognito_username: 'pharmacist@example.com',
      email: 'pharmacist@example.com',
      account_status: 'active',
      memberships: [
        {
          id: 'membership_1',
          org_id: 'org_1',
        },
      ],
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    updateCognitoUserProfileMock.mockResolvedValue(undefined);
    disableCognitoUserMock.mockResolvedValue(undefined);
    userUpdateMock.mockResolvedValue({ id: 'user_1' });
    membershipUpdateMock.mockResolvedValue({ id: 'membership_1' });
    membershipUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        user: {
          update: userUpdateMock,
        },
        membership: {
          update: membershipUpdateMock,
          updateMany: membershipUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('updates pharmacist profile and membership', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'update',
          name: '更新 薬剤師',
          name_kana: 'コウシン ヤクザイシ',
          phone: '090-1111-2222',
          site_id: 'site_2',
          role: 'admin',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'user_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateCognitoUserProfileMock).toHaveBeenCalledWith({
      username: 'pharmacist@example.com',
      email: 'pharmacist@example.com',
      name: '更新 薬剤師',
      phone: '090-1111-2222',
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: expect.objectContaining({
        name: '更新 薬剤師',
        name_kana: 'コウシン ヤクザイシ',
        phone: '090-1111-2222',
      }),
    });
    expect(membershipUpdateMock).toHaveBeenCalledWith({
      where: { id: 'membership_1' },
      data: expect.objectContaining({
        site_id: 'site_2',
        role: 'admin',
        can_audit_dispense: true,
        can_audit_set: true,
      }),
    });
  });

  it('suspends a pharmacist account', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'suspend',
          reason: '長期休職',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'user_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(disableCognitoUserMock).toHaveBeenCalledWith('pharmacist@example.com');
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: expect.objectContaining({
        is_active: false,
        account_status: 'suspended',
        deactivation_reason: '長期休職',
      }),
    });
    expect(membershipUpdateManyMock).toHaveBeenCalledWith({
      where: {
        user_id: 'user_1',
        org_id: 'org_1',
      },
      data: {
        is_active: false,
      },
    });
  });
});
