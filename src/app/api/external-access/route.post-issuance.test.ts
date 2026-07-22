import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  currentRole,
  validateOrgReferencesMock,
  withOrgContextMock,
  issueExternalAccessTokenMock,
  sendSmsMock,
  patientFindFirstMock,
  patientFindManyMock,
  consentRecordFindFirstMock,
  careCaseFindManyMock,
  externalAccessGrantFindFirstMock,
  externalAccessGrantFindManyMock,
  patientSelfReportFindManyMock,
  patientSelfReportGroupByMock,
  createMock,
  updateMock,
  auditLogCreateMock,
  validateExternalAccessScopeForRoleMock,
  MissingExternalAccessSecretErrorMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  currentRole: { value: 'pharmacist' },
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  issueExternalAccessTokenMock: vi.fn(),
  sendSmsMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  externalAccessGrantFindFirstMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  patientSelfReportGroupByMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  validateExternalAccessScopeForRoleMock: vi.fn(),
  MissingExternalAccessSecretErrorMock: class MissingExternalAccessSecretError extends Error {
    constructor() {
      super('External access token secret is not configured');
      this.name = 'MissingExternalAccessSecretError';
    }
  },
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => unknown,
    options?: { permission?: string; message?: string },
  ) => {
    const permissionsByRole: Record<string, Record<string, boolean>> = {
      owner: { canReport: true, canSendCareReport: true, canManagePatientSharing: true },
      admin: { canReport: true, canSendCareReport: true, canManagePatientSharing: true },
      pharmacist: { canReport: true, canSendCareReport: true, canManagePatientSharing: true },
      pharmacist_trainee: {
        canReport: true,
        canSendCareReport: false,
        canManagePatientSharing: false,
      },
      clerk: { canReport: true, canSendCareReport: false, canManagePatientSharing: false },
      driver: { canReport: false, canSendCareReport: false, canManagePatientSharing: false },
      external_viewer: {
        canReport: false,
        canSendCareReport: false,
        canManagePatientSharing: false,
      },
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
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    externalAccessGrant: {
      findFirst: externalAccessGrantFindFirstMock,
      findMany: externalAccessGrantFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
      groupBy: patientSelfReportGroupByMock,
    },
  },
}));

vi.mock('@/server/services/external-access', async () => {
  const actual = await vi.importActual<typeof import('@/server/services/external-access')>(
    '@/server/services/external-access',
  );
  return {
    ...actual,
    issueExternalAccessToken: issueExternalAccessTokenMock,
    validateExternalAccessScopeForRole: validateExternalAccessScopeForRoleMock,
    MissingExternalAccessSecretError: MissingExternalAccessSecretErrorMock,
  };
});

vi.mock('@/server/adapters/sms', () => ({
  SmsNotificationAdapter: class SmsNotificationAdapter {
    async sendSms(phoneNumber: string, message: string) {
      return sendSmsMock(phoneNumber, message);
    }
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/external-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/external-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"patient_id":',
  });
}

// 新ポリシー: org-wide ロール(pharmacist 等)は担当割当スコープを撤廃。
// canAccessPatient / listAccessiblePatientCaseIds は org_id(+id/patient_id)のみで照合する。
function expectPharmacistPatientAssignmentWhere(patientId?: string) {
  return {
    ...(patientId ? { id: patientId } : {}),
    org_id: 'org_1',
  };
}

const EXTERNAL_ACCESS_AUDIT_ALLOWED_KEYS = [
  'actor_id',
  'expires_at',
  'expires_hours',
  'granted_to_contact_masked',
  'granted_to_name',
  'otp_delivery_intent',
  'patient_id',
  'scope',
  'scope_keys',
] as const;

function expectExternalAccessAuditChangesSafe(changes: Record<string, unknown>) {
  expect(Object.keys(changes).sort()).toEqual([...EXTERNAL_ACCESS_AUDIT_ALLOWED_KEYS].sort());
  for (const key of [
    'otp',
    'raw_otp',
    'otp_hash',
    'token',
    'token_hash',
    'provisional_token',
    'provisional_token_hash',
    'jwt',
    'secret',
  ]) {
    expect(changes).not.toHaveProperty(key);
  }

  const auditJson = JSON.stringify(changes);
  const createData = createMock.mock.calls[0]?.[0]?.data ?? {};
  const updateData = updateMock.mock.calls[0]?.[0]?.data ?? {};
  for (const verifier of [createData.token_hash, createData.otp_hash, updateData.token_hash]) {
    if (typeof verifier === 'string' && verifier.length > 0) {
      expect(auditJson).not.toContain(verifier);
    }
  }
}

describe('/api/external-access POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendSmsMock.mockResolvedValue({
      status: 'accepted',
      provider: 'twilio',
      providerMessageId: `SM${'a'.repeat(32)}`,
    });
    currentRole.value = 'pharmacist';
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'external_sharing_consent_1',
      case_id: null,
    });
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
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: patientFindFirstMock,
          findMany: patientFindManyMock,
        },
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
        },
        careCase: {
          findMany: careCaseFindManyMock,
        },
        externalAccessGrant: {
          create: createMock,
          update: updateMock,
          findFirst: externalAccessGrantFindFirstMock,
          findMany: externalAccessGrantFindManyMock,
        },
        patientSelfReport: {
          findMany: patientSelfReportFindManyMock,
          groupBy: patientSelfReportGroupByMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it.each(['driver', 'external_viewer'])(
    'rejects %s without report access before validating or creating a grant',
    async (role) => {
      currentRole.value = role;

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
      expect(response.status).toBe(403);
      expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
      expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
    },
  );

  it('rejects non-object JSON payloads before scope validation, patient lookup, or grant creation', async () => {
    const response = await POST(createRequest([]), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before scope validation, patient lookup, or grant creation', async () => {
    const response = await POST(createMalformedJsonRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('rejects blank grant identity fields before scope validation, patient lookup, or grant creation', async () => {
    const response = await POST(
      createRequest({
        patient_id: '   ',
        granted_to_name: '\t',
        granted_to_contact: null,
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        patient_id: ['患者IDは必須です'],
        granted_to_name: ['共有先氏名は必須です'],
      },
    });
    expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  // F80: 外部共有grantの発行は canManagePatientSharing を要求する管理操作。
  // canVisit を持つ pharmacist_trainee でも、per-scope 検証に到達する前に
  // ルートガードで 403 となり、medication_list のPHIを外部発行できない。
  it('rejects a pharmacist trainee from issuing a grant at the management-permission guard before scope validation or side effects', async () => {
    currentRole.value = 'pharmacist_trainee';

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
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '外部共有の作成権限がありません',
    });
    // ルートガードで遮断されるため、per-scope 検証・患者照合・grant作成には到達しない。
    expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('rejects a clerk from issuing a grant at the management-permission guard before scope validation or side effects', async () => {
    currentRole.value = 'clerk';

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
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '外部共有の作成権限がありません',
    });
    // clerk も canManagePatientSharing:false のためルートガードで遮断。
    expect(validateExternalAccessScopeForRoleMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('issues a JWT-backed grant and sends the OTP by SMS when the contact is a phone number', async () => {
    const response = await POST(
      createRequest({
        patient_id: ' patient_1 ',
        granted_to_name: ' 田中ケアマネ ',
        granted_to_contact: ' 090-1234-5678 ',
        scope: { medication_list: true },
        expires_hours: 72,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(validateOrgReferencesMock).toHaveBeenCalledWith(
      'org_1',
      { patient_id: 'patient_1' },
      expect.any(Object),
    );
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expectPharmacistPatientAssignmentWhere('patient_1'),
      select: { id: true },
    });
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: expect.any(Date) } }],
        AND: [{ OR: [{ case_id: null }] }],
      },
      orderBy: [{ obtained_date: 'desc' }],
      select: { id: true, case_id: true },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
      }),
      select: expect.any(Object),
    });
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
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'external_access_grant_created',
        target_type: 'external_access_grant',
        target_id: 'grant_1',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          granted_to_name: '田中ケアマネ',
          granted_to_contact_masked: '090****5678',
          scope: { medication_list: true },
          scope_keys: ['medication_list'],
          expires_hours: 72,
          otp_delivery_intent: 'sms',
          actor_id: 'user_1',
        }),
      }),
    });
    const smsAuditChanges = auditLogCreateMock.mock.calls[0]?.[0]?.data.changes;
    expectExternalAccessAuditChangesSafe(smsAuditChanges);
    expect(smsAuditChanges).not.toHaveProperty('otp');
    expect(JSON.stringify(smsAuditChanges)).not.toContain('jwt-token');
    expect(sendSmsMock).toHaveBeenCalledWith(
      '090-1234-5678',
      expect.stringContaining('PH-OS共有OTP:'),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'external_access_otp_delivery_accepted',
        changes: expect.objectContaining({
          otp_delivery_result: 'sms',
          provider_status: 'accepted',
          provider_message_id: `SM${'a'.repeat(32)}`,
        }),
      }),
    });
    expect(validateExternalAccessScopeForRoleMock).toHaveBeenCalledWith(
      { medication_list: true },
      'pharmacist',
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        token: 'jwt-token',
        granted_to_contact_masked: '090****5678',
        otp_delivery: 'sms',
        otp_delivery_destination: '090****5678',
      },
    });
    expect(body.data).not.toHaveProperty('otp');
    expect(body.data).not.toHaveProperty('granted_to_contact');
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('09012345678');
    expect(bodyText).not.toMatch(/token_hash|otp_hash|provisional|bcrypt/);
  });

  it('keeps the grant creation audit when SMS is not configured and returns the OTP manually', async () => {
    sendSmsMock.mockResolvedValueOnce({
      status: 'not_configured',
      provider: null,
      providerMessageId: null,
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'external_access_grant_created',
        changes: expect.objectContaining({
          granted_to_contact_masked: '090****5678',
          otp_delivery_intent: 'sms',
        }),
      }),
    });
    const body = await response.json();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'external_access_otp_delivery_fallback',
        target_type: 'external_access_grant',
        target_id: 'grant_1',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          granted_to_contact_masked: '090****5678',
          otp_delivery_intent: 'sms',
          otp_delivery_result: 'manual',
          provider_status: 'not_configured',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(body).toMatchObject({
      data: {
        token: 'jwt-token',
        otp: expect.any(String),
        otp_delivery: 'manual',
      },
    });
    const auditChanges = auditLogCreateMock.mock.calls[0]?.[0]?.data.changes;
    const fallbackChanges = auditLogCreateMock.mock.calls.find(
      ([call]) => call.data.action === 'external_access_otp_delivery_fallback',
    )?.[0].data.changes;
    expectExternalAccessAuditChangesSafe(auditChanges);
    expect(auditChanges).not.toHaveProperty('otp');
    expect(JSON.stringify(auditChanges)).not.toContain(body.data.otp);
    expect(JSON.stringify(auditChanges)).not.toContain(body.data.token);
    expect(JSON.stringify(fallbackChanges)).not.toContain(body.data.otp);
    expect(JSON.stringify(fallbackChanges)).not.toContain(body.data.token);
    expect(body.data).not.toHaveProperty('granted_to_contact');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('09012345678');
    expect(JSON.stringify(body)).not.toMatch(/token_hash|otp_hash|provisional|bcrypt/);
  });

  it('revokes the grant and returns no token when SMS fallback audit persistence fails', async () => {
    sendSmsMock.mockRejectedValueOnce(new Error('sms unavailable'));
    auditLogCreateMock
      .mockResolvedValueOnce({ id: 'grant-audit' })
      .mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'grant_1' },
      data: { revoked_at: expect.any(Date) },
    });
    const responseText = await response.text();
    expect(responseText).not.toContain('jwt-token');
    expect(responseText).not.toContain('090-1234-5678');
    expect(responseText).not.toContain('09012345678');
    expect(responseText).not.toMatch(/\b\d{6}\b/);
  });

  it('logs a safe warning when grant revocation fails after fallback audit persistence fails', async () => {
    sendSmsMock.mockRejectedValueOnce(new Error('sms unavailable'));
    auditLogCreateMock
      .mockResolvedValueOnce({ id: 'grant-audit' })
      .mockRejectedValueOnce(new Error('audit unavailable'));
    const revokeError = new Error('revocation failed for 090-1234-5678 token=jwt-token otp=123456');
    updateMock.mockResolvedValueOnce({ id: 'grant_1' }).mockRejectedValueOnce(revokeError);

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(updateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'grant_1' },
      data: { revoked_at: expect.any(Date) },
    });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'external_access_grant_rollback_failed',
        route: '/api/external-access',
        method: 'POST',
        operation: 'revoke_external_access_grant_after_audit_failure',
        orgId: 'org_1',
        actorId: 'user_1',
        entityType: 'external_access_grant',
        targetId: 'grant_1',
      },
      revokeError,
    );
    const loggedContext = loggerWarnMock.mock.calls[0]?.[0];
    expect(JSON.stringify(loggedContext)).not.toContain('090-1234-5678');
    expect(JSON.stringify(loggedContext)).not.toContain('jwt-token');
    expect(JSON.stringify(loggedContext)).not.toMatch(/\b\d{6}\b/);
    const responseText = await response.text();
    expect(responseText).not.toContain('jwt-token');
    expect(responseText).not.toContain('090-1234-5678');
    expect(responseText).not.toMatch(/\b\d{6}\b/);
  });
});
