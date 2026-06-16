import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindManyMock,
  userFindManyMock,
  inviteCognitoUserMock,
  deleteCognitoUserMock,
  withOrgContextMock,
  userCreateMock,
  membershipCreateMock,
  pharmacistCredentialCreateMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  inviteCognitoUserMock: vi.fn(),
  deleteCognitoUserMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  userCreateMock: vi.fn(),
  membershipCreateMock: vi.fn(),
  pharmacistCredentialCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySite: {
      findMany: pharmacySiteFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock('@/server/services/cognito-admin', () => ({
  inviteCognitoUser: inviteCognitoUserMock,
  deleteCognitoUser: deleteCognitoUserMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacists/import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacists/import', {
    method: 'POST',
    body: '{',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/pharmacists/import POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
    pharmacySiteFindManyMock.mockResolvedValue([{ id: 'site_1', name: '本店' }]);
    userFindManyMock.mockResolvedValue([]);
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito-sub-1',
      username: 'bulk@example.com',
    });
    deleteCognitoUserMock.mockResolvedValue(undefined);
    userCreateMock.mockResolvedValue({ id: 'user_1' });
    membershipCreateMock.mockResolvedValue({ id: 'membership_1' });
    pharmacistCredentialCreateMock.mockResolvedValue({ id: 'cred_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        user: { create: userCreateMock },
        membership: { create: membershipCreateMock },
        pharmacistCredential: { create: pharmacistCredentialCreateMock },
        auditLog: { create: auditLogCreateMock },
      }),
    );
  });

  it('rejects non-object import payloads before loading sites or inviting users', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacySiteFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON import payloads before loading sites or inviting users', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacySiteFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
  });

  it('imports a CSV row and creates membership plus credential', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: ' 山田 太郎 ',
            name_kana: ' ヤマダ タロウ ',
            email: ' Bulk@Example.COM ',
            phone: ' 090-1111-2222 ',
            role: ' pharmacist ',
            site_name: ' 本店 ',
            certification_type: ' かかりつけ薬剤師研修認定 ',
            certification_number: ' R-001 ',
            issued_date: ' 2025-04-01 ',
            expiry_date: ' 2027-03-31 ',
            tenure_years: ' 5 ',
            weekly_work_hours: ' 32 ',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'bulk@example.com',
      name: '山田 太郎',
      phone: '090-1111-2222',
      phosTenantId: 'org_1',
      phosRole: 'PHARMACIST',
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        email: 'bulk@example.com',
        name_kana: 'ヤマダ タロウ',
        phone: '090-1111-2222',
        can_accept_emergency: true,
        visit_specialties: [],
        coverage_area: [],
      }),
    });
    expect(membershipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        site_id: 'site_1',
        role: 'pharmacist',
      }),
    });
    expect(pharmacistCredentialCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 'user_1',
        certification_type: 'かかりつけ薬剤師研修認定',
        certification_number: 'R-001',
        issued_date: new Date('2025-04-01'),
        expiry_date: new Date('2027-03-31'),
        tenure_years: 5,
        weekly_work_hours: 32,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 1,
        failed_count: 0,
        outcome: 'created',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'bulk@example.com',
            name: '山田 太郎',
            status: 'created',
          }),
        ],
      },
    });
  });

  it('normalizes blank optional CSV fields to null without creating a credential', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 花子',
            name_kana: 'ヤマダ ハナコ',
            email: 'blank@example.com',
            phone: '   ',
            role: 'pharmacist',
            site_name: '本店',
            certification_type: ' ',
            certification_number: ' ',
            issued_date: ' ',
            expiry_date: '',
            tenure_years: ' ',
            weekly_work_hours: '',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'blank@example.com',
      name: '山田 花子',
      phone: undefined,
      phosTenantId: 'org_1',
      phosRole: 'PHARMACIST',
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'blank@example.com',
        phone: null,
      }),
    });
    expect(pharmacistCredentialCreateMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 1,
        failed_count: 0,
        outcome: 'created',
      },
    });
  });

  it('accepts E.164 phone numbers and forwards them to Cognito invite', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '佐藤 次郎',
            name_kana: 'サトウ ジロウ',
            email: 'e164@example.com',
            phone: ' +819012345678 ',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'e164@example.com',
      name: '佐藤 次郎',
      phone: '+819012345678',
      phosTenantId: 'org_1',
      phosRole: 'PHARMACIST',
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'e164@example.com',
        phone: '+819012345678',
      }),
    });
  });

  it('reports malformed phone numbers as row failures before loading sites or inviting users', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bad-phone@example.com',
            phone: '090-ABCD-1234',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'bad-phone@example.com',
            name: '山田 太郎',
            status: 'failed',
            message: expect.stringContaining('電話番号形式が不正です'),
          }),
        ],
      },
    });
    expect(pharmacySiteFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('reports row schema failures and continues importing valid rows', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bad-phone@example.com',
            phone: '090-ABCD-1234',
            role: 'pharmacist',
            site_name: '本店',
          },
          {
            name: '佐藤 花子',
            name_kana: 'サトウ ハナコ',
            email: 'valid@example.com',
            phone: '090-1234-5678',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(pharmacySiteFindManyMock).toHaveBeenCalledTimes(1);
    expect(userFindManyMock).toHaveBeenCalledTimes(1);
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        email: { in: ['valid@example.com'] },
      },
      select: { email: true },
    });
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'valid@example.com',
      name: '佐藤 花子',
      phone: '090-1234-5678',
      phosTenantId: 'org_1',
      phosRole: 'PHARMACIST',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 1,
        failed_count: 1,
        outcome: 'partial_failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'bad-phone@example.com',
            status: 'failed',
            message: expect.stringContaining('電話番号形式が不正です'),
          }),
          expect.objectContaining({
            row_number: 2,
            email: 'valid@example.com',
            status: 'created',
          }),
        ],
      },
    });
  });

  it('reports credential details without a certification type as row failures before loading sites', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bulk@example.com',
            role: 'pharmacist',
            site_name: '本店',
            certification_number: 'R-001',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'bulk@example.com',
            status: 'failed',
            message: expect.stringContaining('認定種別が必須です'),
          }),
        ],
      },
    });
    expect(pharmacySiteFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('reports non-plain credential numeric fields as row failures before loading sites', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bulk@example.com',
            role: 'pharmacist',
            site_name: '本店',
            certification_type: '研修認定',
            tenure_years: '1e1',
            weekly_work_hours: '32hours',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'bulk@example.com',
            status: 'failed',
            message: expect.stringContaining('入力値が不正です'),
          }),
        ],
      },
    });
    expect(pharmacySiteFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('fails duplicate normalized emails before inviting users', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: ' Duplicate@Example.COM ',
            role: 'pharmacist',
            site_name: '本店',
          },
          {
            name: '佐藤 花子',
            name_kana: 'サトウ ハナコ',
            email: 'duplicate@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 2,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'duplicate@example.com',
            status: 'failed',
          }),
          expect.objectContaining({
            row_number: 2,
            email: 'duplicate@example.com',
            status: 'failed',
          }),
        ],
      },
    });
  });

  it('fails ambiguous site names before inviting users', async () => {
    pharmacySiteFindManyMock.mockResolvedValue([
      { id: 'site_1', name: '本店' },
      { id: 'site_2', name: ' 本店 ' },
    ]);

    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bulk@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            status: 'failed',
            message: '店舗 "本店" は同名店舗があるため特定できません',
          }),
        ],
      },
    });
  });

  it('loads existing users once for all import candidates and skips already registered emails', async () => {
    userFindManyMock.mockResolvedValue([{ email: 'existing@example.com' }]);
    inviteCognitoUserMock
      .mockResolvedValueOnce({
        sub: 'cognito-sub-new-1',
        username: 'new-1@example.com',
      })
      .mockResolvedValueOnce({
        sub: 'cognito-sub-new-2',
        username: 'new-2@example.com',
      });

    const response = await POST(
      createRequest({
        rows: [
          {
            name: '既存 太郎',
            name_kana: 'キソン タロウ',
            email: 'Existing@Example.COM',
            role: 'pharmacist',
            site_name: '本店',
          },
          {
            name: '新規 一郎',
            name_kana: 'シンキ イチロウ',
            email: 'new-1@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
          {
            name: '新規 二郎',
            name_kana: 'シンキ ジロウ',
            email: 'new-2@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(userFindManyMock).toHaveBeenCalledTimes(1);
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        email: { in: ['existing@example.com', 'new-1@example.com', 'new-2@example.com'] },
      },
      select: { email: true },
    });
    expect(inviteCognitoUserMock).toHaveBeenCalledTimes(2);
    expect(inviteCognitoUserMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ email: 'new-1@example.com' }),
    );
    expect(inviteCognitoUserMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ email: 'new-2@example.com' }),
    );
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 2,
        failed_count: 1,
        outcome: 'partial_failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'existing@example.com',
            status: 'failed',
            message: '同じメールアドレスのユーザーが既に存在します',
          }),
          expect.objectContaining({
            row_number: 2,
            email: 'new-1@example.com',
            status: 'created',
          }),
          expect.objectContaining({
            row_number: 3,
            email: 'new-2@example.com',
            status: 'created',
          }),
        ],
      },
    });
  });

  it('reports a missing required site without creating the user', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bulk@example.com',
            role: 'pharmacist',
            site_name: '未登録店舗',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            status: 'failed',
          }),
        ],
      },
    });
  });

  it('reports database creation failures as row failures and continues importing', async () => {
    userCreateMock.mockRejectedValueOnce(new Error('database write failed'));
    inviteCognitoUserMock
      .mockResolvedValueOnce({
        sub: 'cognito-sub-1',
        username: 'first@example.com',
      })
      .mockResolvedValueOnce({
        sub: 'cognito-sub-2',
        username: 'second@example.com',
      });

    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'first@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
          {
            name: '佐藤 花子',
            name_kana: 'サトウ ハナコ',
            email: 'second@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).toHaveBeenCalledTimes(2);
    expect(deleteCognitoUserMock).toHaveBeenCalledTimes(1);
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('first@example.com');
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(userCreateMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 1,
        failed_count: 1,
        outcome: 'partial_failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'first@example.com',
            status: 'failed',
            message: 'スタッフ作成に失敗しました',
          }),
          expect.objectContaining({
            row_number: 2,
            email: 'second@example.com',
            status: 'created',
          }),
        ],
      },
    });
  });

  it('reports administrator follow-up when Cognito cleanup fails after a row persistence error', async () => {
    userCreateMock.mockRejectedValueOnce(new Error('database write failed'));
    deleteCognitoUserMock.mockRejectedValueOnce(new Error('delete failed'));
    inviteCognitoUserMock.mockResolvedValueOnce({
      sub: 'cognito-sub-1',
      username: 'cleanup-failed@example.com',
    });

    const response = await POST(
      createRequest({
        rows: [
          {
            name: '削除失敗 薬剤師',
            name_kana: 'サクジョシッパイ ヤクザイシ',
            email: 'cleanup-failed@example.com',
            role: 'pharmacist',
            site_name: '本店',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(deleteCognitoUserMock).toHaveBeenCalledWith('cleanup-failed@example.com');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        outcome: 'failed',
        results: [
          expect.objectContaining({
            row_number: 1,
            email: 'cleanup-failed@example.com',
            status: 'failed',
            message:
              'スタッフ作成に失敗しました。Cognito ユーザーの削除に失敗したため管理者確認が必要です',
          }),
        ],
      },
    });
  });
});
