import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  deleteCognitoUserMock,
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
  deleteCognitoUserMock: vi.fn(),
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
  deleteCognitoUser: deleteCognitoUserMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/organizations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/organizations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"name":',
  });
}

function setupCreateTransaction() {
  const createTx = {
    organization: { create: organizationCreateMock },
    pharmacySite: { create: pharmacySiteCreateMock },
    user: { create: userCreateMock },
    membership: { create: membershipCreateMock },
  };
  transactionMock.mockImplementationOnce(
    async (callback: (tx: typeof createTx) => Promise<unknown>) => callback(createTx),
  );
}

function setupCleanupTransaction() {
  const cleanupTx = {
    organization: { delete: organizationDeleteMock },
    pharmacySite: { delete: pharmacySiteDeleteMock },
    user: { delete: userDeleteMock },
    membership: { deleteMany: membershipDeleteManyMock },
  };
  transactionMock.mockImplementationOnce(
    async (callback: (tx: typeof cleanupTx) => Promise<unknown>) => callback(cleanupTx),
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
    deleteCognitoUserMock.mockResolvedValue(undefined);
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
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before duplicate checks or tenant writes', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(deleteCognitoUserMock).not.toHaveBeenCalled();
  });

  it('rejects non-object organization payloads before duplicate checks', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only required organization fields before duplicate checks', async () => {
    const response = await POST(
      createRequest({
        name: '   ',
        site_name: ' ',
        site_address: '\t',
        admin_email: 'admin@example.com',
        admin_name: '\n',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        name: ['組織名は必須です'],
        site_name: ['薬局名は必須です'],
        site_address: ['薬局住所は必須です'],
        admin_name: ['管理者氏名は必須です'],
      },
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
  });

  it('rejects malformed optional phone fields before duplicate checks', async () => {
    const response = await POST(
      createRequest({
        name: '新規法人',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
        phone: '090-ABCD-1234',
        site_phone: '03-ABCD-5678',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        phone: ['電話番号形式が不正です'],
        site_phone: ['電話番号形式が不正です'],
      },
    });
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional organization fields to null without duplicate corporate lookup', async () => {
    setupCreateTransaction();
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito_sub_1',
      username: 'admin@example.com',
    });

    const response = await POST(
      createRequest({
        name: '新規法人',
        corporate_number: '   ',
        address: ' ',
        phone: '\t',
        email: ' ',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        site_phone: '\n',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(organizationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          corporate_number: null,
          address: null,
          phone: null,
          email: null,
        }),
      }),
    );
    expect(pharmacySiteCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: null,
        }),
      }),
    );
    expect(deleteCognitoUserMock).not.toHaveBeenCalled();
  });

  it('normalizes required organization fields and admin email after successful Cognito invite', async () => {
    setupCreateTransaction();
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito_sub_1',
      username: 'admin@example.com',
    });

    const response = await POST(
      createRequest({
        name: ' 新規法人 ',
        corporate_number: ' 1234567890123 ',
        address: ' 東京都新宿区2-2-2 ',
        phone: ' 03-1234-5678 ',
        email: ' Info@Example.com ',
        site_name: ' 新宿店 ',
        site_address: ' 東京都新宿区1-1-1 ',
        site_phone: ' +81 3 1234 5678 ',
        admin_email: ' Admin@Example.com ',
        admin_name: ' 管理者 ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { corporate_number: '1234567890123' },
      select: { id: true },
    });
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      select: { id: true },
    });
    expect(userCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@example.com',
          name: '管理者',
        }),
      }),
    );
    expect(organizationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '新規法人',
          corporate_number: '1234567890123',
          address: '東京都新宿区2-2-2',
          phone: '03-1234-5678',
          email: 'Info@Example.com',
        }),
      }),
    );
    expect(pharmacySiteCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '新宿店',
          address: '東京都新宿区1-1-1',
          phone: '+81 3 1234 5678',
        }),
      }),
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
    expect(deleteCognitoUserMock).not.toHaveBeenCalled();
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
      }),
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
    expect(deleteCognitoUserMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('deletes the invited Cognito user and tenant state when final user update fails', async () => {
    setupCreateTransaction();
    setupCleanupTransaction();
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito_sub_1',
      username: 'admin@example.com',
    });
    userUpdateMock.mockRejectedValueOnce(new Error('final update failed'));

    const response = await POST(
      createRequest({
        name: '新規法人',
        corporate_number: '1234567890123',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ORGANIZATION_PROVISIONING_FAILED',
      message: '組織作成中に最終更新が失敗しました。変更をロールバックしました。',
    });
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('admin@example.com');
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
  });

  it('reports a partial failure when final user update rollback fails', async () => {
    setupCreateTransaction();
    transactionMock.mockRejectedValueOnce(new Error('tenant cleanup failed'));
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito_sub_1',
      username: 'admin@example.com',
    });
    userUpdateMock.mockRejectedValueOnce(new Error('final update failed'));

    const response = await POST(
      createRequest({
        name: '新規法人',
        site_name: '新宿店',
        site_address: '東京都新宿区1-1-1',
        admin_email: 'admin@example.com',
        admin_name: '管理者',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ORGANIZATION_PROVISIONING_PARTIAL_FAILURE',
      message: '組織作成中に最終更新が失敗し、ロールバックにも失敗しました。手動確認が必要です。',
    });
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('admin@example.com');
    expect(membershipDeleteManyMock).not.toHaveBeenCalled();
    expect(userDeleteMock).not.toHaveBeenCalled();
    expect(pharmacySiteDeleteMock).not.toHaveBeenCalled();
    expect(organizationDeleteMock).not.toHaveBeenCalled();
  });
});
