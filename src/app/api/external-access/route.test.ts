import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  currentRole,
  validateOrgReferencesMock,
  withOrgContextMock,
  issueExternalAccessTokenMock,
  sendSmsMock,
  patientFindManyMock,
  externalAccessGrantFindManyMock,
  patientSelfReportFindManyMock,
  createMock,
  updateMock,
  validateExternalAccessScopeForRoleMock,
  MissingExternalAccessSecretErrorMock,
} = vi.hoisted(() => ({
  currentRole: { value: 'pharmacist' },
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  issueExternalAccessTokenMock: vi.fn(),
  sendSmsMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  validateExternalAccessScopeForRoleMock: vi.fn(),
  MissingExternalAccessSecretErrorMock: class MissingExternalAccessSecretError extends Error {
    constructor() {
      super('External access token secret is not configured');
      this.name = 'MissingExternalAccessSecretError';
    }
  },
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => unknown,
    options?: { permission?: string; message?: string },
  ) => {
    const permissionsByRole: Record<string, Record<string, boolean>> = {
      owner: { canReport: true, canSendCareReport: true },
      admin: { canReport: true, canSendCareReport: true },
      pharmacist: { canReport: true, canSendCareReport: true },
      pharmacist_trainee: { canReport: true, canSendCareReport: false },
      clerk: { canReport: true, canSendCareReport: false },
      driver: { canReport: false, canSendCareReport: false },
      external_viewer: { canReport: false, canSendCareReport: false },
    };

    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      options?.permission && !permissionsByRole[currentRole.value]?.[options.permission]
        ? new Response(
            JSON.stringify({
              code: 'AUTH_FORBIDDEN',
              message: options.message ?? '権限がありません',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          )
        : handler(req, { orgId: 'org_1', userId: 'user_1', role: currentRole.value }, routeContext);
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
    externalAccessGrant: {
      findMany: externalAccessGrantFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
  },
}));

vi.mock('@/server/services/external-access', () => ({
  issueExternalAccessToken: issueExternalAccessTokenMock,
  validateExternalAccessScopeForRole: validateExternalAccessScopeForRoleMock,
  MissingExternalAccessSecretError: MissingExternalAccessSecretErrorMock,
}));

vi.mock('@/server/adapters/sms', () => ({
  SmsNotificationAdapter: class SmsNotificationAdapter {
    async sendSms(phoneNumber: string, message: string) {
      return sendSmsMock(phoneNumber, message);
    }
  },
}));

import { GET, POST } from './route';

const routeContext = { params: Promise.resolve({}) };

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

function createGetRequest(url = 'http://localhost/api/external-access') {
  return {
    url,
  } as unknown as NextRequest;
}

describe('/api/external-access GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = 'pharmacist';
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '09012345678',
        scope: { care_reports: true },
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
      },
    ]);
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        external_access_grant_id: 'grant_1',
        status: 'open',
        created_at: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);
  });

  it.each(['clerk', 'pharmacist_trainee'])(
    'rejects %s before listing sensitive external sharing metadata',
    async (role) => {
      currentRole.value = role;

      const response = await GET(createGetRequest(), routeContext);

      expect(response.status).toBe(403);
      expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '外部共有の閲覧権限がありません',
      });
    },
  );

  it('lists external access management metadata for a role allowed to send care reports', async () => {
    currentRole.value = 'pharmacist';

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?patient_id=patient_1'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        revoked_at: null,
        patient_id: 'patient_1',
      },
      orderBy: { created_at: 'desc' },
      select: expect.any(Object),
    });
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['patient_1'] },
      },
      select: {
        id: true,
        name: true,
        name_kana: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'grant_1',
          patient_id: 'patient_1',
          granted_to_name: '田中ケアマネ',
          granted_to_contact: '09012345678',
          patient: {
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
          },
          self_report_summary: {
            total: 1,
            open: 1,
            latest_at: '2026-04-02T00:00:00.000Z',
          },
        },
      ],
    });
  });
});

describe('/api/external-access POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = 'pharmacist';
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    issueExternalAccessTokenMock.mockResolvedValue('jwt-token');
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: true,
      scope: { medication_list: true },
    });
    createMock.mockResolvedValue({
      id: 'grant_1',
      patient_id: 'patient_1',
      granted_to_name: '田中ケアマネ',
      granted_to_contact: '09012345678',
      scope: { medication_list: true },
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    updateMock.mockResolvedValue({ id: 'grant_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalAccessGrant: {
          create: createMock,
          update: updateMock,
        },
      }),
    );
  });

  it('issues a JWT-backed grant and sends the OTP by SMS when the contact is a phone number', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 72,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(issueExternalAccessTokenMock).toHaveBeenCalledWith({
      grantId: 'grant_1',
      orgId: 'org_1',
      patientId: 'patient_1',
      expiresHours: 72,
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'grant_1' },
      data: {
        token_hash: expect.any(String),
      },
    });
    expect(sendSmsMock).toHaveBeenCalledWith(
      '090-1234-5678',
      expect.stringContaining('CareViaX共有OTP:'),
    );
    expect(validateExternalAccessScopeForRoleMock).toHaveBeenCalledWith(
      { medication_list: true },
      'pharmacist',
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        token: 'jwt-token',
        otp_delivery: 'sms',
        otp_delivery_destination: '090****5678',
      },
    });
  });

  it('keeps OTP delivery manual when the contact is not a phone number', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: 'care@example.com',
        scope: { medication_list: true },
        expires_hours: 48,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(sendSmsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        token: 'jwt-token',
        otp_delivery: 'manual',
        otp_delivery_destination: null,
      },
    });
  });

  it('accepts a null contact from the share form and still creates a manual-delivery grant', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        granted_to_contact: null,
      }),
      select: expect.any(Object),
    });
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the external access signing secret is missing', async () => {
    issueExternalAccessTokenMock.mockRejectedValue(new MissingExternalAccessSecretErrorMock());

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_ACCESS_SECRET_MISSING',
    });
  });

  it('rejects invalid scope keys before creating a grant', async () => {
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { unknown_scope_keys: ['clinical_notes'] },
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { medication_list: true, clinical_notes: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a sensitive scope requires a stronger local permission', async () => {
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: false,
      kind: 'permission',
      message: 'この共有範囲を発行する権限がありません',
      details: { denied_scope_keys: ['care_reports'] },
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { care_reports: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
  });
});
