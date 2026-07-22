import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
} from '@/lib/patient/archive-summary';

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

// 新ポリシー: org-wide ロール(pharmacist 等)は担当割当スコープを撤廃。
// canAccessPatient / listAccessiblePatientCaseIds は org_id(+id/patient_id)のみで照合する。
function expectPharmacistPatientAssignmentWhere(patientId?: string) {
  return {
    ...(patientId ? { id: patientId } : {}),
    org_id: 'org_1',
  };
}

function expectPharmacistCareCaseAssignmentWhere(patientId: string) {
  return {
    org_id: 'org_1',
    patient_id: patientId,
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
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
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

  it('rejects archived patients before token, OTP, grant, or SMS side effects', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
      message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', role: 'pharmacist', userId: 'user_1' },
      isolationLevel: 'Serializable',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('stores a hidden case boundary for case-backed external sharing scopes', async () => {
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: true,
      scope: { care_reports: true, visit_schedule: true },
    });
    createMock.mockResolvedValue({
      id: 'grant_1',
      patient_id: 'patient_1',
      granted_to_name: '田中ケアマネ',
      granted_to_contact: null,
      scope: { care_reports: true, visit_schedule: true, allowed_case_ids: ['case_1'] },
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { care_reports: true, visit_schedule: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: expectPharmacistCareCaseAssignmentWhere('patient_1'),
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
        AND: [{ OR: [{ case_id: null }, { case_id: { in: ['case_1'] } }] }],
      },
      orderBy: [{ obtained_date: 'desc' }],
      select: { id: true, case_id: true },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: {
          care_reports: true,
          visit_schedule: true,
          allowed_case_ids: ['case_1'],
        },
      }),
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scope: { care_reports: true, visit_schedule: true },
      },
    });
  });

  it('rejects case-backed external sharing when no assigned case remains', async () => {
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: true,
      scope: { care_reports: true },
    });
    careCaseFindManyMock.mockResolvedValue([]);

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
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('keeps OTP delivery manual when the contact is not a phone number', async () => {
    createMock.mockResolvedValueOnce({
      id: 'grant_1',
      patient_id: 'patient_1',
      granted_to_name: '田中ケアマネ',
      granted_to_contact: 'care@example.com',
      scope: { medication_list: true },
      expires_at: new Date('2026-04-01T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });

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
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'external_access_grant_created',
        changes: expect.objectContaining({
          granted_to_contact_masked: 'c***@example.com',
          otp_delivery_intent: 'manual',
        }),
      }),
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        token: 'jwt-token',
        granted_to_contact_masked: 'c***@example.com',
        otp: expect.any(String),
        otp_delivery: 'manual',
        otp_delivery_destination: null,
      },
    });
    expect(body.data).not.toHaveProperty('granted_to_contact');
    expect(JSON.stringify(body)).not.toContain('care@example.com');
    expect(JSON.stringify(body)).not.toMatch(/token_hash|otp_hash|provisional|bcrypt/);
    const auditChanges = auditLogCreateMock.mock.calls[0]?.[0]?.data.changes;
    expectExternalAccessAuditChangesSafe(auditChanges);
    expect(auditChanges).not.toHaveProperty('otp');
    expect(JSON.stringify(auditChanges)).not.toContain(body.data.otp);
    expect(JSON.stringify(auditChanges)).not.toContain(body.data.token);
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

  it('requires active external-sharing consent before token, OTP, grant, audit, or SMS side effects', async () => {
    consentRecordFindFirstMock.mockResolvedValueOnce(null);

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '外部共有の有効な同意が未登録または期限切れです',
      details: {
        consent_type: 'external_sharing',
        scope_keys: ['medication_list'],
      },
    });
    expect(validateOrgReferencesMock).toHaveBeenCalled();
    expect(patientFindFirstMock).toHaveBeenCalled();
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
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', role: 'pharmacist', userId: 'user_1' },
      isolationLevel: 'Serializable',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible patient before OTP, token, grant, or SMS side effects', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        patient_id: 'patient_denied',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '090-1234-5678',
        scope: { medication_list: true },
        expires_hours: 24,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith(
      'org_1',
      { patient_id: 'patient_denied' },
      expect.any(Object),
    );
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expectPharmacistPatientAssignmentWhere('patient_denied'),
      select: { id: true },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', role: 'pharmacist', userId: 'user_1' },
      isolationLevel: 'Serializable',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
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
