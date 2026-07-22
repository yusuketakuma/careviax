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

import { GET } from './route';

const routeContext = { params: Promise.resolve({}) };

function createGetRequest(url = 'http://localhost/api/external-access') {
  return new NextRequest(url);
}

describe('/api/external-access GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          findFirst: externalAccessGrantFindFirstMock,
          findMany: externalAccessGrantFindManyMock,
        },
        patientSelfReport: {
          findMany: patientSelfReportFindManyMock,
          groupBy: patientSelfReportGroupByMock,
        },
      }),
    );
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
      meta: {
        has_more: false,
        next_cursor: null,
      },
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
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body.meta.has_more).toBe(true);
    expect(body.meta.next_cursor).toBe('grant_199');
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
      meta: {
        has_more: false,
        next_cursor: null,
      },
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
