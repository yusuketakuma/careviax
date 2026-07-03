import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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
    patientSelfReportGroupByMock.mockImplementation((args) => {
      if (args.where?.status) {
        return Promise.resolve([
          {
            external_access_grant_id: 'grant_1',
            _count: { _all: 1 },
          },
        ]);
      }
      return Promise.resolve([
        {
          external_access_grant_id: 'grant_1',
          _count: { _all: 1 },
          _max: { created_at: new Date('2026-04-02T00:00:00.000Z') },
        },
      ]);
    });
  });

  // X01 / CXR2-SEC01 (2026-07-03 human 承認): 外部共有grantの org-wide 列挙は
  // canManagePatientSharing を要求する管理操作。canManagePatientSharing:false の
  // ロール(clerk / pharmacist_trainee / driver / external_viewer)は、canReport や
  // canVisit を持っていてもルートガードで 403 となり、grant 本体・共有先・スコープ・
  // 自己申告サマリのいずれのメタデータ読み取りにも到達しない(POST の F80 ガードを鏡写し)。
  it.each(['clerk', 'pharmacist_trainee', 'driver', 'external_viewer'])(
    'rejects %s at the management-permission guard before listing external sharing metadata',
    async (role) => {
      currentRole.value = role;

      const response = await GET(createGetRequest(), routeContext);

      expect(response.status).toBe(403);
      // ルートガードで遮断されるため、grant 列挙・患者名補完・自己申告集計には到達しない。
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
      expect(patientSelfReportGroupByMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '外部共有の閲覧権限がありません',
      });
    },
  );

  it.each(['owner', 'admin'])(
    'lets %s list external sharing metadata through management access',
    async (role) => {
      currentRole.value = role;

      const response = await GET(createGetRequest(), routeContext);

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
      await expect(response.json()).resolves.toMatchObject({
        data: [expect.objectContaining({ id: 'grant_1' })],
      });
    },
  );

  // X01: org-wide な grant 列挙(patient_id 無し)経路も、grant 本体・患者名補完・
  // 自己申告サマリの全クエリが org_id で閉じており、他 org の grant は不可視。
  it('scopes the org-wide grant enumeration to the caller org so other-org grants are invisible', async () => {
    currentRole.value = 'pharmacist';

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    // 列挙本体は org_id + revoked_at:null のみで他 org を含めない。
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', revoked_at: null },
      }),
    );
    // 患者名の補完も呼び出し org に限定する。
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1' }),
      }),
    );
    // 自己申告サマリの集計も org スコープ。
    for (const call of patientSelfReportGroupByMock.mock.calls) {
      expect(call[0].where).toMatchObject({ org_id: 'org_1' });
    }
  });

  it.each([
    ['empty patient_id', 'patient_id='],
    ['blank patient_id', 'patient_id=%20%20'],
  ])('rejects %s before grant visibility reads', async (_label, query) => {
    currentRole.value = 'pharmacist';

    const response = await GET(
      createGetRequest(`http://localhost/api/external-access?${query}`),
      routeContext,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { patient_id: ['患者IDを指定してください'] },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportGroupByMock).not.toHaveBeenCalled();
  });

  it('lists external access management metadata for a role allowed to send care reports', async () => {
    currentRole.value = 'pharmacist';

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?patient_id=%20patient_1%20'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    // 新ポリシー: 組織内フルアクセスのため担当割当スコープ(grant visibility OR)は付かず、
    // org_id + patient_id の単純なリスト取得になる。
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        revoked_at: null,
        patient_id: 'patient_1',
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
      take: 201,
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
    expect(patientSelfReportFindManyMock).not.toHaveBeenCalled();
    expect(patientSelfReportGroupByMock).toHaveBeenCalledTimes(2);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: 'grant_1',
          patient_id: 'patient_1',
          granted_to_name: '田中ケアマネ',
          granted_to_contact_masked: '090****5678',
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
      hasMore: false,
      nextCursor: null,
    });
    expect(body.data[0]).not.toHaveProperty('granted_to_contact');
    const payloadText = JSON.stringify(body);
    expect(payloadText).not.toContain('09012345678');
  });

  it('returns hasMore and nextCursor without returning the sentinel row', async () => {
    const grants = Array.from({ length: 201 }, (_, index) => ({
      id: `grant_${index.toString().padStart(3, '0')}`,
      org_id: 'org_1',
      patient_id: 'patient_1',
      granted_to_name: '田中ケアマネ',
      granted_to_contact: null,
      scope: { care_reports: true },
      expires_at: new Date('2026-04-03T00:00:00.000Z'),
      accessed_at: null,
      created_at: new Date('2026-04-01T00:00:00.000Z'),
    }));
    externalAccessGrantFindManyMock.mockResolvedValue(grants);
    patientSelfReportGroupByMock.mockResolvedValue([]);

    const response = await GET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(200);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('grant_199');
    expect(body.data.at(-1).id).toBe('grant_199');
  });

  it('rejects stale grant cursors before listing grant rows', async () => {
    externalAccessGrantFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?cursor=stale_cursor'),
      routeContext,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cursor: ['カーソルが見つかりません'] },
    });
    expect(externalAccessGrantFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        revoked_at: null,
        id: 'stale_cursor',
      },
      select: { id: true },
    });
    expect(externalAccessGrantFindManyMock).not.toHaveBeenCalled();
  });

  it('uses a valid grant cursor as a stable page boundary', async () => {
    externalAccessGrantFindFirstMock.mockResolvedValueOnce({ id: 'grant_1' });

    const response = await GET(
      createGetRequest('http://localhost/api/external-access?cursor=grant_1'),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'grant_1' },
        skip: 1,
        take: 201,
      }),
    );
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
    await expect(response.json()).resolves.toEqual({
      data: [],
      hasMore: false,
      nextCursor: null,
    });
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
        take: 201,
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
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
      take: 201,
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
        take: 201,
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
        externalAccessGrant: {
          create: createMock,
          update: updateMock,
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
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      patient_id: 'patient_1',
    });
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

  it('keeps the grant creation audit when SMS delivery falls back to manual OTP handling', async () => {
    sendSmsMock.mockRejectedValueOnce(new Error('sms unavailable'));

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
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
