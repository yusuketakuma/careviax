import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  organizationFindUniqueMock,
  organizationCreateMock,
  organizationDeleteMock,
  userFindUniqueMock,
  userCreateMock,
  userDeleteMock,
  userUpdateMock,
  pharmacySiteCreateMock,
  pharmacySiteDeleteMock,
  membershipCreateMock,
  membershipDeleteManyMock,
  transactionMock,
  inviteCognitoUserMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  organizationCreateMock: vi.fn(),
  organizationDeleteMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userCreateMock: vi.fn(),
  userDeleteMock: vi.fn(),
  userUpdateMock: vi.fn(),
  pharmacySiteCreateMock: vi.fn(),
  pharmacySiteDeleteMock: vi.fn(),
  membershipCreateMock: vi.fn(),
  membershipDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(),
  inviteCognitoUserMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    user: {
      findUnique: userFindUniqueMock,
      update: userUpdateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@/server/services/cognito-admin', () => ({
  inviteCognitoUser: inviteCognitoUserMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    method: 'POST',
    headers: {
      get: () => null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function setupCreateTransaction() {
  const createTx = {
    organization: { create: organizationCreateMock },
    pharmacySite: { create: pharmacySiteCreateMock },
    user: { create: userCreateMock },
    membership: { create: membershipCreateMock },
  };
  transactionMock.mockImplementationOnce(async (callback: (tx: typeof createTx) => Promise<unknown>) =>
    callback(createTx)
  );
}

function setupCleanupTransaction() {
  const cleanupTx = {
    organization: { delete: organizationDeleteMock },
    pharmacySite: { delete: pharmacySiteDeleteMock },
    user: { delete: userDeleteMock },
    membership: { deleteMany: membershipDeleteManyMock },
  };
  transactionMock.mockImplementationOnce(async (callback: (tx: typeof cleanupTx) => Promise<unknown>) =>
    callback(cleanupTx)
  );
}

describe('/api/admin/organizations POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'owner_1',
        orgId: 'org_1',
        role: 'owner',
      },
    });
    organizationFindUniqueMock.mockResolvedValue(null);
    userFindUniqueMock.mockResolvedValue(null);
    organizationCreateMock.mockResolvedValue({
      id: 'org_new',
      name: '新規法人',
      created_at: new Date('2026-04-05T00:00:00.000Z'),
    });
    pharmacySiteCreateMock.mockResolvedValue({
      id: 'site_new',
      name: '新宿店',
    });
    userCreateMock.mockResolvedValue({
      id: 'user_new',
      email: 'admin@example.com',
      name: '管理者',
    });
    membershipCreateMock.mockResolvedValue({
      id: 'membership_new',
      role: 'owner',
    });
    userUpdateMock.mockResolvedValue({
      id: 'user_new',
    });
    membershipDeleteManyMock.mockResolvedValue({ count: 1 });
    userDeleteMock.mockResolvedValue({ id: 'user_new' });
    pharmacySiteDeleteMock.mockResolvedValue({ id: 'site_new' });
    organizationDeleteMock.mockResolvedValue({ id: 'org_new' });
  });

  it('returns 403 for non-owner admins', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'admin_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });

    const response = await POST(
      createRequest({
        name: '新規法人',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('normalizes admin email and returns 201 after successful Cognito invite', async () => {
    setupCreateTransaction();
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito_sub_1',
      username: 'admin@example.com',
    });

    const response = await POST(
      createRequest({
        name: '新規法人',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: ' Admin@Example.com ',
        admin_name: '管理者',
      })
    );

    if (!response) throw new Error('response is required');
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      select: { id: true },
    });
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@example.com',
        }),
      })
    );
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'admin@example.com',
      name: '管理者',
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_new' },
      data: {
        cognito_sub: 'cognito_sub_1',
        cognito_username: 'admin@example.com',
        account_status: 'invited',
      },
    });
    expect(response.status).toBe(201);
  });

  it('rolls back created tenant state when Cognito invite fails', async () => {
    setupCreateTransaction();
    setupCleanupTransaction();
    inviteCognitoUserMock.mockRejectedValue(new Error('UsernameExistsException'));

    const response = await POST(
      createRequest({
        name: '新規法人',
        corporate_number: '1234567890123',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(membershipDeleteManyMock).toHaveBeenCalledWith({
      where: { user_id: 'user_new', org_id: 'org_new' },
    });
    expect(userDeleteMock).toHaveBeenCalledWith({
      where: { id: 'user_new' },
    });
    expect(pharmacySiteDeleteMock).toHaveBeenCalledWith({
      where: { id: 'site_new' },
    });
    expect(organizationDeleteMock).toHaveBeenCalledWith({
      where: { id: 'org_new' },
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
