import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  return new NextRequest('http://localhost/api/pharmacists/user_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/pharmacists/user_1', {
    method: 'PATCH',
    body: '{',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
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
      }),
    );
  });

  it('rejects non-object update payloads before loading the pharmacist', async () => {
    const response = await PATCH(createRequest([], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'user_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the pharmacist', async () => {
    const response = await PATCH(createMalformedJsonRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'user_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed phone numbers before loading the pharmacist', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'update',
          name: '不正 電話',
          name_kana: 'フセイ デンワ',
          phone: '090-ABCD-1234',
          role: 'admin',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'user_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        phone: ['電話番号形式が不正です'],
      },
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank route ids before loading the pharmacist', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'suspend',
          reason: '長期休職',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '薬剤師IDが不正です',
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
    expect(disableCognitoUserMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('updates pharmacist profile and membership', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'update',
          name: '更新 薬剤師',
          name_kana: 'コウシン ヤクザイシ',
          phone: ' 090-1111-2222 ',
          site_id: 'site_2',
          role: 'admin',
          visit_specialties: ['terminal_care'],
          coverage_area: ['新宿区'],
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'user_1' }) },
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
        visit_specialties: ['terminal_care'],
        coverage_area: ['新宿区'],
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

  it('allows overriding workflow permission flags on update', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'update',
          name: '更新 薬剤師',
          name_kana: 'コウシン ヤクザイシ',
          phone: '090-1111-2222',
          site_id: 'site_2',
          role: 'admin',
          can_dispense: true,
          can_set: false,
          can_audit_dispense: false,
          can_audit_set: true,
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'user_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(membershipUpdateMock).toHaveBeenCalledWith({
      where: { id: 'membership_1' },
      data: expect.objectContaining({
        role: 'admin',
        can_dispense: true,
        can_set: false,
        can_audit_dispense: false,
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
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'user_1' }) },
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

  it('updates an external collaborator without requiring a site assignment', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'update',
          name: '外部連携 共有先',
          name_kana: 'ガイブレンケイ キョウユウサキ',
          phone: '090-2222-3333',
          role: 'external_viewer',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'user_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: undefined,
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: expect.objectContaining({
        name: '外部連携 共有先',
        max_daily_visits: null,
        max_weekly_visits: null,
        max_travel_minutes: null,
        can_accept_emergency: false,
        visit_specialties: [],
        coverage_area: [],
      }),
    });
    expect(membershipUpdateMock).toHaveBeenCalledWith({
      where: { id: 'membership_1' },
      data: expect.objectContaining({
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
