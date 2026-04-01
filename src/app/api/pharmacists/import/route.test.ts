import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindManyMock,
  userFindFirstMock,
  inviteCognitoUserMock,
  withOrgContextMock,
  userCreateMock,
  membershipCreateMock,
  pharmacistCredentialCreateMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  inviteCognitoUserMock: vi.fn(),
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
      findFirst: userFindFirstMock,
    },
  },
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
    json: async () => body,
  } as unknown as NextRequest;
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
    userFindFirstMock.mockResolvedValue(null);
    inviteCognitoUserMock.mockResolvedValue({
      sub: 'cognito-sub-1',
      username: 'bulk@example.com',
    });
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
      })
    );
  });

  it('imports a CSV row and creates membership plus credential', async () => {
    const response = await POST(
      createRequest({
        rows: [
          {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            email: 'bulk@example.com',
            phone: '090-1111-2222',
            role: 'pharmacist',
            site_name: '本店',
            certification_type: 'かかりつけ薬剤師研修認定',
            certification_number: 'R-001',
            issued_date: '2025-04-01',
            expiry_date: '2027-03-31',
            tenure_years: 5,
            weekly_work_hours: 32,
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).toHaveBeenCalledWith({
      email: 'bulk@example.com',
      name: '山田 太郎',
      phone: '090-1111-2222',
    });
    expect(userCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        email: 'bulk@example.com',
        can_accept_emergency: true,
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
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 1,
        failed_count: 0,
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
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inviteCognitoUserMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created_count: 0,
        failed_count: 1,
        results: [
          expect.objectContaining({
            status: 'failed',
          }),
        ],
      },
    });
  });
});
