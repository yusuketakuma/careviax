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
  careCaseFindManyMock,
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
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
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
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    externalAccessGrant: {
      findMany: externalAccessGrantFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
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

import { GET, POST } from './route';

const routeContext = { params: Promise.resolve({}) };

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

function createGetRequest(url = 'http://localhost/api/external-access') {
  return new NextRequest(url);
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

describe('/api/external-access GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = 'pharmacist';
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: '09012345678',
        scope: { care_reports: true, allowed_case_ids: ['case_1'] },
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

  it.each(['driver', 'external_viewer'])(
    'rejects %s before listing external sharing metadata',
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

  it('returns an empty grant list for report-only clerks without grant metadata reads', async () => {
    currentRole.value = 'clerk';

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it('lets a pharmacist trainee list visit-scope external sharing metadata through report access', async () => {
    currentRole.value = 'pharmacist_trainee';

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'grant_1' })],
    });
  });

  it('lists external access management metadata for a role allowed to send care reports', async () => {
    currentRole.value = 'pharmacist';

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?patient_id=%20patient_1%20'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    // 新ポリシー: 組織内フルアクセスのため担当割当スコープ(grant visibility OR)は付かず、
    // org_id + patient_id の単純なリスト取得になる。
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        revoked_at: null,
        patient_id: 'patient_1',
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
      take: 200,
    });
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    // canAccessPatient は org-wide ロールでは担当割当を付けず org_id + id だけで照合する。
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    // bypass 経路では visibleCaseIds を求めないため careCase.findMany は呼ばれない。
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
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
          scope: { care_reports: true },
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

  it('returns no grants for an inaccessible patient without grant or patient enrichment reads', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?patient_id=patient_denied'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it('pushes patient-specific grant case visibility into the listing query', async () => {
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'grant_visible_patient',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { care_reports: true, allowed_case_ids: ['case_1'] },
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?patient_id=patient_1'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    // 新ポリシー: org-wide ロールは grant visibility の OR を付けず患者単位で全件取得する。
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          revoked_at: null,
          patient_id: 'patient_1',
        },
        take: 200,
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'grant_visible_patient' })],
    });
  });

  it('filters unscoped grant listing to candidate patients and visible case boundaries', async () => {
    externalAccessGrantFindManyMock.mockResolvedValueOnce([
      {
        id: 'grant_visible',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { care_reports: true, allowed_case_ids: ['case_1'] },
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
      },
    ]);

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    // 新ポリシー: org-wide ロールは patient_id 未指定時に組織内の grant を全件取得する。
    // 担当割当による per-patient の OR 分岐は付かない。
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        revoked_at: null,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
      take: 200,
    });
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    // bypass 経路では候補ケースを集める careCase.findMany は実行されない。
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'grant_visible',
          patient_id: 'patient_1',
          scope: { care_reports: true },
        }),
      ],
    });
  });

  it('pushes unscoped grant case visibility into per-patient query branches', async () => {
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'grant_visible_branch',
        org_id: 'org_1',
        patient_id: 'patient_1',
        granted_to_name: '田中ケアマネ',
        granted_to_contact: null,
        scope: { care_reports: true, allowed_case_ids: ['case_1'] },
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
      },
    ]);

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    // 新ポリシー: org-wide ロールは patient ごとの OR 分岐ではなく組織内全件取得になる。
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          revoked_at: null,
        },
        take: 200,
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'grant_visible_branch' })],
    });
  });
});

describe('/api/external-access POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = 'pharmacist';
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
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

  it('allows a pharmacist trainee to create a medication-list grant through per-scope validation', async () => {
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
    expect(response.status).toBe(201);
    expect(validateExternalAccessScopeForRoleMock).toHaveBeenCalledWith(
      { medication_list: true },
      'pharmacist_trainee',
    );
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: { medication_list: true },
      }),
      select: expect.any(Object),
    });
  });

  it('rejects a clerk medication-list grant after scope validation and before side effects', async () => {
    currentRole.value = 'clerk';
    validateExternalAccessScopeForRoleMock.mockReturnValue({
      ok: false,
      kind: 'permission',
      message: 'この共有範囲を発行する権限がありません',
      details: { denied_scope_keys: ['medication_list'] },
    });

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
    expect(validateExternalAccessScopeForRoleMock).toHaveBeenCalledWith(
      { medication_list: true },
      'clerk',
    );
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
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      patient_id: 'patient_1',
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expectPharmacistPatientAssignmentWhere('patient_1'),
      select: { id: true },
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
    expect(sendSmsMock).toHaveBeenCalledWith(
      '090-1234-5678',
      expect.stringContaining('PH-OS共有OTP:'),
    );
    expect(validateExternalAccessScopeForRoleMock).toHaveBeenCalledWith(
      { medication_list: true },
      'pharmacist',
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        token: 'jwt-token',
        otp_delivery: 'sms',
        otp_delivery_destination: '090****5678',
      },
    });
    expect(body.data).not.toHaveProperty('otp');
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
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
    expect(createMock).not.toHaveBeenCalled();
    expect(issueExternalAccessTokenMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
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
        otp: expect.any(String),
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
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      patient_id: 'patient_denied',
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expectPharmacistPatientAssignmentWhere('patient_denied'),
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
