import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  userFindFirstMock,
  userFindManyMock,
  userUpdateManyMock,
  txUserFindFirstMock,
  txUserUpdateManyMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  changePasswordMock,
  confirmForgotPasswordMock,
  adminGlobalSignOutMock,
  resolveLocalUserByIdentityMock,
} = vi.hoisted(() => ({
  userFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userUpdateManyMock: vi.fn(),
  txUserFindFirstMock: vi.fn(),
  txUserUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  changePasswordMock: vi.fn(),
  confirmForgotPasswordMock: vi.fn(),
  adminGlobalSignOutMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
}));

vi.mock('node:crypto', async (importActual) => ({
  ...(await importActual<typeof import('node:crypto')>()),
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findFirst: userFindFirstMock,
      findMany: userFindManyMock,
      updateMany: userUpdateManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));
vi.mock('@/lib/audit/audit-entry', () => ({ createAuditLogEntry: createAuditLogEntryMock }));
vi.mock('@/server/services/cognito-auth', () => ({
  changePasswordWithAccessToken: changePasswordMock,
  confirmForgotPassword: confirmForgotPasswordMock,
}));
vi.mock('@/server/services/cognito-admin', () => ({
  adminGlobalSignOutCognitoUser: adminGlobalSignOutMock,
}));

import {
  changePasswordAndRevokeSessions,
  confirmForgotPasswordAndRevokeSessions,
  reconcileCredentialRevocationIntents,
} from './credential-revocation';

const user = {
  id: 'user_1',
  org_id: 'org_1',
  email: 'user@example.com',
  cognito_username: 'cognito-user',
};

describe('credential revocation orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindFirstMock.mockResolvedValue(user);
    resolveLocalUserByIdentityMock.mockResolvedValue(user);
    userFindManyMock.mockResolvedValue([]);
    userUpdateManyMock.mockResolvedValue({ count: 1 });
    txUserFindFirstMock.mockResolvedValue({ credential_revocation_local_completed_at: null });
    txUserUpdateManyMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    changePasswordMock.mockResolvedValue(undefined);
    confirmForgotPasswordMock.mockResolvedValue(undefined);
    adminGlobalSignOutMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        user: { findFirst: txUserFindFirstMock, updateMany: txUserUpdateManyMock },
        auditLog: { create: vi.fn() },
      }),
    );
  });

  it('persists intent before provider change and clears it only after local epoch, audit, and admin sign-out', async () => {
    await changePasswordAndRevokeSessions({
      userId: 'user_1',
      orgId: 'org_1',
      accessToken: 'access-token',
      currentPassword: 'old-password',
      newPassword: 'new-password',
      actor: { ipAddress: '127.0.0.1' },
    });

    expect(userUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ credential_revocation_id: null }),
        data: expect.objectContaining({
          credential_revocation_id: '11111111-1111-4111-8111-111111111111',
          credential_revocation_flow: 'password_change',
        }),
      }),
    );
    expect(changePasswordMock).toHaveBeenCalledOnce();
    expect(txUserUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ session_version: { increment: 1 } }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledOnce();
    expect(adminGlobalSignOutMock).toHaveBeenCalledWith('cognito-user');
    expect(userUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ credential_revocation_id: null }),
      }),
    );
  });

  it('cancels an intent after a definitive provider rejection without revoking sessions', async () => {
    const error = new Error('wrong password');
    error.name = 'NotAuthorizedException';
    changePasswordMock.mockRejectedValueOnce(error);

    await expect(
      changePasswordAndRevokeSessions({
        userId: 'user_1',
        orgId: 'org_1',
        accessToken: 'access-token',
        currentPassword: 'wrong',
        newPassword: 'new-password',
        actor: {},
      }),
    ).rejects.toBe(error);

    expect(userUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(adminGlobalSignOutMock).not.toHaveBeenCalled();
  });

  it('retains the durable fail-closed intent after an ambiguous provider failure', async () => {
    const error = new Error('socket timeout');
    changePasswordMock.mockRejectedValueOnce(error);

    await expect(
      changePasswordAndRevokeSessions({
        userId: 'user_1',
        orgId: 'org_1',
        accessToken: 'access-token',
        currentPassword: 'old-password',
        newPassword: 'new-password',
        actor: {},
      }),
    ).rejects.toBe(error);

    expect(userUpdateManyMock).toHaveBeenCalledOnce();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('keeps the intent when Cognito global sign-out fails after local exact-once completion', async () => {
    adminGlobalSignOutMock.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      changePasswordAndRevokeSessions({
        userId: 'user_1',
        orgId: 'org_1',
        accessToken: 'access-token',
        currentPassword: 'old-password',
        newPassword: 'new-password',
        actor: {},
      }),
    ).rejects.toThrow('provider unavailable');

    expect(txUserUpdateManyMock).toHaveBeenCalledOnce();
    expect(createAuditLogEntryMock).toHaveBeenCalledOnce();
    expect(userUpdateManyMock).toHaveBeenCalledTimes(2);
  });

  it('reconciles stale intents without incrementing or auditing local completion twice', async () => {
    userFindManyMock.mockResolvedValueOnce([
      {
        ...user,
        credential_revocation_id: 'intent_1',
        credential_revocation_flow: 'password_reset',
      },
    ]);
    txUserFindFirstMock.mockResolvedValueOnce({
      credential_revocation_local_completed_at: new Date('2026-07-16T00:00:00Z'),
    });

    const result = await reconcileCredentialRevocationIntents();

    expect(result).toEqual({ processedCount: 1, scannedCount: 1, errors: [] });
    expect(txUserUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(adminGlobalSignOutMock).toHaveBeenCalledOnce();
  });

  it('does not expose whether an unknown reset identity exists locally', async () => {
    resolveLocalUserByIdentityMock.mockResolvedValueOnce(null);

    await confirmForgotPasswordAndRevokeSessions({
      email: ' UNKNOWN@example.com ',
      code: '123456',
      newPassword: 'new-password',
      actor: {},
    });

    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'unknown@example.com',
      code: '123456',
      newPassword: 'new-password',
    });
    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });

  it('applies the same durable all-device revocation contract to password reset', async () => {
    await confirmForgotPasswordAndRevokeSessions({
      email: ' USER@example.com ',
      code: '123456',
      newPassword: 'new-password',
      actor: {},
    });

    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'new-password',
    });
    expect(userUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ credential_revocation_flow: 'password_reset' }),
      }),
    );
    expect(txUserUpdateManyMock).toHaveBeenCalledOnce();
    expect(adminGlobalSignOutMock).toHaveBeenCalledOnce();
  });
});
