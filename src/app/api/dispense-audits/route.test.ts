import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  notifyWorkflowMutationMock,
  dispenseTaskFindManyMock,
  dispenseTaskCountMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  dispenseTaskCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body: unknown) {
  const requestBody =
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'task_id' in body &&
    'result' in body &&
    !('expected_version' in body)
      ? { ...body, expected_version: 1 }
      : body;
  return new NextRequest('http://localhost/api/dispense-audits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  } satisfies NextRequestInit);
}

function createRawRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-audits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/dispense-audits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"task_id":',
  } satisfies NextRequestInit);
}

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/dispense-audits${search}`);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function setupAuthMocks() {
  requireAuthContextMock.mockResolvedValue({
    ctx: {
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist' as const,
    },
  });
  runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
  withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
}

function doubleCountResultRow(
  overrides: Partial<{
    line_id: string;
    actual_drug_name: string;
    actual_drug_code: string | null;
    actual_quantity: number;
    actual_unit: string | null;
    drug_name: string;
    drug_code: string | null;
    unit: string | null;
    packaging_instruction_tags: string[];
  }> = {},
) {
  return {
    line_id: overrides.line_id ?? 'line_narcotic',
    actual_drug_name: overrides.actual_drug_name ?? 'モルヒネ徐放錠',
    actual_drug_code: overrides.actual_drug_code ?? 'YJ_NARCOTIC',
    actual_quantity: overrides.actual_quantity ?? 12,
    actual_unit: overrides.actual_unit ?? '錠',
    line: {
      drug_name: overrides.drug_name ?? 'モルヒネ徐放錠',
      drug_code: overrides.drug_code ?? 'YJ_NARCOTIC',
      unit: overrides.unit ?? '錠',
      packaging_instruction_tags: overrides.packaging_instruction_tags ?? ['narcotic'],
    },
  };
}

function setupApprovedDoubleCountAuditTx(args: {
  resultRows: Array<ReturnType<typeof doubleCountResultRow>>;
  narcoticMasterYjCodes?: string[];
}) {
  const dispenseResultFindManyMock = vi
    .fn()
    .mockResolvedValueOnce([{ dispensed_by: 'user_dispense' }])
    .mockResolvedValueOnce(args.resultRows);
  const dispenseAuditCreateMock = vi.fn();
  const auditLogCreateMock = vi.fn();
  const cycleUpdateManyMock = vi.fn();
  const drugMasterFindManyMock = vi
    .fn()
    .mockResolvedValue((args.narcoticMasterYjCodes ?? []).map((yjCode) => ({ yj_code: yjCode })));

  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      dispenseTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'task_double_count',
          cycle_id: 'cycle_double_count',
          assigned_to: 'user_dispense',
          due_date: null,
          priority: 'normal',
          cycle: {
            patient_id: 'patient_double_count',
            overall_status: 'audit_pending',
            set_plans: [],
            case_: {
              primary_pharmacist_id: 'pharmacist_1',
              patient: {
                name: '佐藤 花子',
              },
            },
          },
        }),
        update: vi.fn(),
      },
      dispenseResult: {
        findMany: dispenseResultFindManyMock,
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      dispenseAudit: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: dispenseAuditCreateMock,
      },
      drugMaster: {
        findMany: drugMasterFindManyMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
      medicationCycle: {
        findFirst: vi.fn(),
        findFirstOrThrow: vi.fn(),
        updateMany: cycleUpdateManyMock,
      },
      cycleTransitionLog: { create: vi.fn() },
      workflowException: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    }),
  );

  return {
    dispenseResultFindManyMock,
    dispenseAuditCreateMock,
    auditLogCreateMock,
    cycleUpdateManyMock,
    drugMasterFindManyMock,
  };
}

// 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
// buildMedicationCycleAssignmentWhere が null を返し、WHERE に cycle 句は付与されない。

describe('/api/dispense-audits GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          count: dispenseTaskCountMock,
          findMany: dispenseTaskFindManyMock,
        },
      }),
    );
    dispenseTaskCountMock.mockResolvedValue(2);
    dispenseTaskFindManyMock.mockResolvedValue([
      {
        id: 'task_hold',
        priority: 'urgent',
        due_date: new Date('2026-03-29T09:00:00.000Z'),
        updated_at: new Date('2026-03-29T10:00:00.000Z'),
        audits: [
          { id: 'audit_1', result: 'hold', audited_at: new Date('2026-03-29T10:30:00.000Z') },
        ],
        results: [],
        cycle: {
          id: 'cycle_1',
          patient_id: 'patient_1',
          overall_status: 'auditing',
          case_: {
            id: 'case_1',
            patient: {
              id: 'patient_1',
              name: '山田 太郎',
              name_kana: 'ヤマダ タロウ',
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          prescription_intakes: [],
        },
      },
      {
        id: 'task_approved',
        priority: 'normal',
        due_date: null,
        updated_at: new Date('2026-03-29T11:00:00.000Z'),
        audits: [
          { id: 'audit_2', result: 'approved', audited_at: new Date('2026-03-29T11:30:00.000Z') },
        ],
        results: [],
        cycle: {
          id: 'cycle_2',
          patient_id: 'patient_2',
          overall_status: 'visit_ready',
          case_: {
            id: 'case_2',
            patient: {
              id: 'patient_2',
              name: '佐藤 花子',
              name_kana: 'サトウ ハナコ',
              residences: [{ building_id: 'facility_2', address: '施設B' }],
            },
          },
          prescription_intakes: [],
        },
      },
      {
        id: 'task_rejected_corrected',
        priority: 'normal',
        due_date: null,
        updated_at: new Date('2026-03-29T12:00:00.000Z'),
        audits: [
          { id: 'audit_3', result: 'rejected', audited_at: new Date('2026-03-29T11:45:00.000Z') },
        ],
        results: [],
        cycle: {
          id: 'cycle_3',
          patient_id: 'patient_3',
          overall_status: 'audit_pending',
          case_: {
            id: 'case_3',
            patient: {
              id: 'patient_3',
              name: '鈴木 一郎',
              name_kana: 'スズキ イチロウ',
              residences: [{ building_id: 'facility_3', address: '施設C' }],
            },
          },
          prescription_intakes: [],
        },
      },
    ]);
  });

  it('shows hold and corrected rejected items again while excluding already approved audits', async () => {
    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = (await response.json()) as {
      data: Array<{ id: string; facility_label: string | null; is_overdue: boolean }>;
    };
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task_hold',
          facility_label: 'facility_1',
          is_overdue: true,
        }),
        expect.objectContaining({
          id: 'task_rejected_corrected',
          facility_label: 'facility_3',
        }),
      ]),
    );
    expect(payload.data).not.toContainEqual(
      expect.objectContaining({
        id: 'task_approved',
      }),
    );
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'completed',
          audits: {
            none: {
              result: { in: ['approved', 'emergency_approved'] },
            },
          },
        },
      }),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
  });

  it('returns only the visible audit count for nav badges', async () => {
    const response = await GET(createGetRequest('?badge=1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: { count: 2 } });
    expect(dispenseTaskCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        status: 'completed',
        audits: {
          none: {
            result: { in: ['approved', 'emergency_approved'] },
          },
        },
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 when audit queue loading fails without exposing raw PHI', async () => {
    dispenseTaskFindManyMock.mockRejectedValue(
      new Error('audit queue failed for patient 佐藤 花子 insurance 98765432'),
    );

    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(bodyText).not.toContain('佐藤');
    expect(bodyText).not.toContain('98765432');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'dispense_audits_get_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'dispense_audits_get_unhandled_error',
        route: '/api/dispense-audits',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('佐藤');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('98765432');
  });
});

describe('/api/dispense-audits POST', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks();
  });

  it('rejects non-object audit payloads before transaction or notification side effects', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON audit payloads before transaction or notification side effects', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('short-circuits auth failures before parsing malformed JSON or audit side effects', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '調剤鑑査の作成権限がありません' },
        { status: 403 },
      ),
    });

    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '調剤鑑査の作成権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires expected_version before transaction or notification side effects', async () => {
    const response = await POST(
      createRawRequest({
        task_id: 'task_1',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when audit transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 raw dispense audit transaction secret'),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'approved',
      }),
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw dispense audit');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'dispense_audits_post_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'dispense_audits_post_unhandled_error',
        route: '/api/dispense-audits',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('山田太郎');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('raw dispense audit');
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('moves a rejected task back to dispensing and notifies the assignee', async () => {
    const taskUpdateMock = vi.fn().mockResolvedValue({});
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending', version: 1 });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const workflowExceptionCreateMock = vi.fn().mockResolvedValue({});
    const dispenseAuditCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'audit_1', result: 'rejected' });
    const membershipFindFirstMock = vi.fn().mockResolvedValue({ id: 'membership_admin' });
    const membershipFindManyMock = vi
      .fn()
      .mockResolvedValue([{ user_id: 'admin_1' }, { user_id: 'pharmacist_1' }]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            assigned_to: 'user_dispense',
            due_date: new Date('2026-03-29T15:30:00.000Z'),
            priority: 'urgent',
            cycle: {
              patient_id: 'patient_1',
              overall_status: 'audit_pending',
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
          update: taskUpdateMock,
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense' }]),
        },
        membership: {
          findFirst: membershipFindFirstMock,
          findMany: membershipFindManyMock,
        },
        dispenseAudit: {
          create: dispenseAuditCreateMock,
          findFirst: vi.fn().mockResolvedValue(null),
        },
        medicationCycle: {
          findFirst: cycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'dispensing' }),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        workflowException: {
          create: workflowExceptionCreateMock,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'rejected',
        reject_reason: 'wrong_drug',
        reject_reason_code: 'drug_name_mismatch',
        reject_detail: '別規格が混入',
        // §15 帰属検証: クライアントが監査者 id を偽装しても無視され、ctx.userId に帰属する。
        audited_by: 'attacker',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
    expect(cycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: { overall_status: 'dispensing', version: { increment: 1 } },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'in_progress' },
    });
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['admin', 'pharmacist'] },
        }),
      }),
    );
    expect(workflowExceptionCreateMock).toHaveBeenCalled();
    expect(dispenseAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reject_reason: 'wrong_drug',
        reject_reason_code: 'drug_name_mismatch',
        // 帰属は常にセッションユーザ（ctx.userId='user_1'）。偽装 'attacker' は採用しない。
        audited_by: 'user_1',
      }),
    });
    expect(dispenseAuditCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ audited_by: 'attacker' }),
    });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'dispense_audit_rejected',
        link: '/dispense?taskId=task_1',
        message: '山田 太郎 の調剤結果が差戻しになりました（期限 2026-03-30）',
        explicitUserIds: expect.arrayContaining(['user_dispense', 'pharmacist_1', 'admin_1']),
      }),
    );
  });

  it('requires a structured reject_reason_code for rejected audits before side effects', async () => {
    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'rejected',
        reject_reason: 'wrong_drug',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '差戻し時は構造化理由コードが必須です',
      details: {
        reject_reason_code: ['required'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies unassigned tasks before creating audits or notifications', async () => {
    const dispenseAuditCreateMock = vi.fn();
    const dispenseResultFindManyMock = vi.fn();
    const dispenseTaskFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: dispenseTaskFindFirstMock,
        },
        dispenseResult: {
          findMany: dispenseResultFindManyMock,
        },
        dispenseAudit: {
          create: dispenseAuditCreateMock,
          findFirst: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_unassigned',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task_unassigned',
          org_id: 'org_1',
        },
      }),
    );
    expect(dispenseResultFindManyMock).not.toHaveBeenCalled();
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects stale expected_version before creating an audit record', async () => {
    const dispenseAuditCreateMock = vi.fn();
    const taskUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_stale',
            cycle_id: 'cycle_stale',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_1',
              overall_status: 'audit_pending',
              version: 2,
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: { name: '山田 太郎' },
              },
            },
          }),
          update: taskUpdateMock,
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense' }]),
        },
        membership: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        dispenseAudit: {
          findFirst: vi.fn(),
          create: dispenseAuditCreateMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_stale',
        result: 'approved',
        expected_version: 1,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        cycle_id: 'cycle_stale',
        expected_version: 1,
        current_version: 2,
      },
    });
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns an existing matching audit on an exact retry without duplicate side effects', async () => {
    const dispenseResultFindManyMock = vi.fn();
    const dispenseAuditCreateMock = vi.fn();
    const taskUpdateMock = vi.fn();
    const existingAudit = {
      id: 'audit_existing',
      result: 'approved',
      reject_reason: null,
      reject_reason_code: null,
      reject_detail: null,
      audited_by: 'user_1',
      same_operator_reason: null,
    };

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_retry',
            cycle_id: 'cycle_retry',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_1',
              overall_status: 'setting',
              version: 2,
              set_plans: [{ id: 'plan_1' }],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: { name: '山田 太郎' },
              },
            },
          }),
          update: taskUpdateMock,
        },
        dispenseResult: {
          findMany: dispenseResultFindManyMock,
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(existingAudit),
          create: dispenseAuditCreateMock,
        },
        membership: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_retry',
        result: 'approved',
        expected_version: 1,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'audit_existing',
      result: 'approved',
      idempotent: true,
    });
    expect(dispenseResultFindManyMock).not.toHaveBeenCalled();
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows approval re-audit after a rejected audit has been corrected', async () => {
    const dispenseAuditFindFirstMock = vi.fn().mockImplementation((args) => {
      expect(args).toMatchObject({
        where: {
          task_id: 'task_reaudit',
          result: { in: ['approved', 'emergency_approved'] },
        },
      });
      return Promise.resolve(null);
    });
    const dispenseAuditCreateMock = vi.fn().mockResolvedValue({
      id: 'audit_reapproved',
      result: 'approved',
    });
    const taskUpdateMock = vi.fn().mockResolvedValue({});
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_reaudit',
        overall_status: 'audit_pending',
        version: 4,
      })
      .mockResolvedValueOnce({ id: 'cycle_reaudit', overall_status: 'audited', version: 5 });
    const workflowExceptionUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_reaudit',
            cycle_id: 'cycle_reaudit',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_reaudit',
              overall_status: 'audit_pending',
              version: 4,
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: { name: '山田 太郎' },
              },
            },
          }),
          update: taskUpdateMock,
        },
        dispenseResult: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([{ dispensed_by: 'user_dispense' }])
            .mockResolvedValueOnce([
              doubleCountResultRow({
                line_id: 'line_plain',
                actual_drug_code: null,
                drug_code: null,
                packaging_instruction_tags: [],
              }),
            ]),
        },
        membership: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: dispenseAuditFindFirstMock,
          create: dispenseAuditCreateMock,
        },
        drugMaster: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        medicationCycle: {
          findFirst: cycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_reaudit', overall_status: 'visit_ready' }),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: workflowExceptionUpdateManyMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_reaudit',
        result: 'approved',
        expected_version: 4,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'audit_reapproved',
      result: 'approved',
    });
    expect(dispenseAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        task_id: 'task_reaudit',
        result: 'approved',
      }),
    });
    expect(workflowExceptionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle_id: 'cycle_reaudit',
          exception_type: 'dispense_audit_rejected',
          status: 'open',
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'dispense_audits', task_id: 'task_reaudit' },
    });
  });

  it('rejects invalid cycle transitions before creating a dispense audit record', async () => {
    const dispenseAuditCreateMock = vi.fn();
    const taskUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_wrong_phase',
            cycle_id: 'cycle_wrong_phase',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_1',
              overall_status: 'visit_completed',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
          update: taskUpdateMock,
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense' }]),
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        medicationCycle: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_wrong_phase', overall_status: 'visit_completed' }),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: { create: vi.fn() },
        workflowException: {
          create: vi.fn(),
          updateMany: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_wrong_phase',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'ステータス遷移が不正です: visit_completed → audited',
    });
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects emergency approval for non-admin users without a reason', async () => {
    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'emergency_approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '緊急例外承認時は理由の記録が必須です',
    });
  });

  it('moves approved cycles to visit_ready when no set plan exists', async () => {
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    // Two transitions: audit_pending→audited, then audited→visit_ready
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 'cycle_2', overall_status: 'audit_pending', version: 1 })
      .mockResolvedValueOnce({ id: 'cycle_2', overall_status: 'audited', version: 2 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_2',
            cycle_id: 'cycle_2',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_2',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '佐藤 花子',
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense' }]),
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'audit_2', result: 'approved' }),
        },
        medicationCycle: {
          findFirst: cycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_2', overall_status: 'visit_ready' }),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_2',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(cycleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ overall_status: 'visit_ready' }),
      }),
    );
  });

  it('stores double-count evidence after validating it against saved actual quantity', async () => {
    const dispenseResultFindManyMock = vi
      .fn()
      .mockResolvedValueOnce([{ dispensed_by: 'user_dispense' }])
      .mockResolvedValueOnce([doubleCountResultRow()]);
    const dispenseAuditCreateMock = vi.fn().mockResolvedValue({
      id: 'audit_double_count',
      result: 'approved',
    });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'log_double_count' });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_double_count',
        overall_status: 'audit_pending',
        version: 1,
      })
      .mockResolvedValueOnce({ id: 'cycle_double_count', overall_status: 'audited', version: 2 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_double_count',
            cycle_id: 'cycle_double_count',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_double_count',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '佐藤 花子',
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        dispenseResult: {
          findMany: dispenseResultFindManyMock,
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
        medicationCycle: {
          findFirst: cycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_double_count', overall_status: 'visit_ready' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
        double_count: [
          {
            line_id: 'line_narcotic',
            drug_name: 'モルヒネ徐放錠',
            dispensed_quantity: 12,
            first_count: 12,
            second_count: 12,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseResultFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          task_id: 'task_double_count',
        },
        select: {
          line_id: true,
          actual_drug_name: true,
          actual_drug_code: true,
          actual_quantity: true,
          actual_unit: true,
          line: {
            select: {
              drug_name: true,
              drug_code: true,
              unit: true,
              packaging_instruction_tags: true,
            },
          },
        },
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'dispense_audit_double_count',
        target_type: 'DispenseAudit',
        target_id: 'audit_double_count',
        changes: expect.objectContaining({
          task_id: 'task_double_count',
          result: 'approved',
          counts: [
            {
              line_id: 'line_narcotic',
              drug_name: 'モルヒネ徐放錠',
              drug_code: 'YJ_NARCOTIC',
              dispensed_quantity: 12,
              unit: '錠',
              first_count: 12,
              second_count: 12,
              is_narcotic: true,
            },
          ],
        }),
      }),
    });
  });

  it('requires approved double-count evidence for every narcotic dispense result before side effects', async () => {
    const { dispenseAuditCreateMock, auditLogCreateMock, cycleUpdateManyMock } =
      setupApprovedDoubleCountAuditTx({
        resultRows: [doubleCountResultRow()],
      });

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      message: '麻薬ダブルカウントが調剤実績と一致しません',
      details: {
        double_count: [
          {
            line_id: 'line_narcotic',
            reason: 'required_line_missing',
          },
        ],
      },
    });
    expect(JSON.stringify(payload.details)).not.toContain('モルヒネ');
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(cycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires approved double-count evidence when DrugMaster marks an untagged result as narcotic', async () => {
    const {
      dispenseAuditCreateMock,
      auditLogCreateMock,
      cycleUpdateManyMock,
      drugMasterFindManyMock,
    } = setupApprovedDoubleCountAuditTx({
      resultRows: [
        doubleCountResultRow({
          line_id: 'line_master_narcotic',
          actual_drug_name: 'タグ漏れ麻薬',
          actual_drug_code: 'YJ_MASTER_NARCOTIC',
          packaging_instruction_tags: [],
        }),
      ],
      narcoticMasterYjCodes: ['YJ_MASTER_NARCOTIC'],
    });

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: {
        yj_code: { in: expect.arrayContaining(['YJ_MASTER_NARCOTIC']) },
        is_narcotic: true,
      },
      select: { yj_code: true },
    });
    expect(payload).toMatchObject({
      message: '麻薬ダブルカウントが調剤実績と一致しません',
      details: {
        double_count: [
          {
            line_id: 'line_master_narcotic',
            reason: 'required_line_missing',
          },
        ],
      },
    });
    expect(JSON.stringify(payload.details)).not.toContain('タグ漏れ麻薬');
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(cycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects approved double-count mismatches before creating audits or logs', async () => {
    const dispenseResultFindManyMock = vi
      .fn()
      .mockResolvedValueOnce([{ dispensed_by: 'user_dispense' }])
      .mockResolvedValueOnce([doubleCountResultRow()]);
    const dispenseAuditCreateMock = vi.fn();
    const auditLogCreateMock = vi.fn();
    const cycleUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_double_count',
            cycle_id: 'cycle_double_count',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_double_count',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '佐藤 花子',
                },
              },
            },
          }),
          update: vi.fn(),
        },
        dispenseResult: {
          findMany: dispenseResultFindManyMock,
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
        medicationCycle: {
          findFirst: vi.fn(),
          findFirstOrThrow: vi.fn(),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn() },
        workflowException: {
          create: vi.fn(),
          updateMany: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
        double_count: [
          {
            line_id: 'line_narcotic',
            drug_name: 'モルヒネ徐放錠',
            dispensed_quantity: 12,
            first_count: 11,
            second_count: 12,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      message: '麻薬ダブルカウントが調剤実績と一致しません',
      details: {
        double_count: [
          {
            line_id: 'line_narcotic',
            field: 'first_count',
            reason: 'actual_quantity_mismatch',
          },
        ],
      },
    });
    expect(JSON.stringify(payload.details)).not.toContain('モルヒネ');
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(cycleUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects approved double-count rows whose line has no saved dispense result', async () => {
    const { dispenseAuditCreateMock, auditLogCreateMock, cycleUpdateManyMock } =
      setupApprovedDoubleCountAuditTx({ resultRows: [] });

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
        double_count: [
          {
            line_id: 'line_unknown',
            drug_name: 'モルヒネ徐放錠',
            dispensed_quantity: 12,
            first_count: 12,
            second_count: 12,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      message: '麻薬ダブルカウントが調剤実績と一致しません',
      details: {
        double_count: [
          {
            line_id: 'line_unknown',
            reason: 'result_missing',
          },
        ],
      },
    });
    expect(JSON.stringify(payload.details)).not.toContain('モルヒネ');
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(cycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires both approved double-count count entries before creating audits or logs', async () => {
    const { dispenseAuditCreateMock, auditLogCreateMock, cycleUpdateManyMock } =
      setupApprovedDoubleCountAuditTx({
        resultRows: [doubleCountResultRow()],
      });

    const response = await POST(
      createRequest({
        task_id: 'task_double_count',
        result: 'approved',
        double_count: [
          {
            line_id: 'line_narcotic',
            drug_name: 'モルヒネ徐放錠',
            dispensed_quantity: 12,
            first_count: null,
            second_count: 12,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      message: '麻薬ダブルカウントが調剤実績と一致しません',
      details: {
        double_count: [
          {
            line_id: 'line_narcotic',
            field: 'first_count',
            reason: 'value_required',
          },
        ],
      },
    });
    expect(JSON.stringify(payload.details)).not.toContain('モルヒネ');
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(cycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows a self-audit exception when an admin supplies a reason (D1=B)', async () => {
    // ctx.userId = 'user_1' が調剤者でもある → 自己監査。admin 承認 + 理由ありで許可される。
    const dispenseAuditCreateMock = vi.fn().mockResolvedValue({
      id: 'audit_self',
      result: 'approved',
    });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'log_1' });
    const membershipFindFirstMock = vi.fn().mockResolvedValue({ id: 'membership_admin' });
    // 2 回の遷移: audit_pending→audited, audited→visit_ready
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 'cycle_self', overall_status: 'audit_pending', version: 1 })
      .mockResolvedValueOnce({ id: 'cycle_self', overall_status: 'audited', version: 2 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_self',
            cycle_id: 'cycle_self',
            assigned_to: 'user_1',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_self',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'user_1',
                patient: { name: '田中 一郎' },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        dispenseResult: {
          // 調剤者 = ctx.userId('user_1') → 自己監査が成立する
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_1' }]),
        },
        membership: {
          findFirst: membershipFindFirstMock,
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
        medicationCycle: {
          findFirst: cycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_self', overall_status: 'visit_ready' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_self',
        result: 'approved',
        same_operator_reason: '単独勤務のため自己監査',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    // admin 承認確認のため membership を参照している
    expect(membershipFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user_1',
          role: { in: ['owner', 'admin'] },
        }),
      }),
    );
    // 例外フィールド(理由・承認 admin)が DispenseAudit に記録される
    expect(dispenseAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        same_operator_reason: '単独勤務のため自己監査',
        same_operator_approved_by: 'user_1',
        audited_by: 'user_1',
      }),
    });
    // append-only の操作証跡 (AuditLog self_audit_exception) が残る
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'self_audit_exception',
        target_type: 'DispenseAudit',
        target_id: 'audit_self',
        actor_id: 'user_1',
        changes: expect.objectContaining({
          same_operator_reason: '単独勤務のため自己監査',
          same_operator_approved_by: 'user_1',
        }),
      }),
    });
  });

  it('rejects a self-audit with 422 when no reason is supplied', async () => {
    const dispenseAuditCreateMock = vi.fn();
    const membershipFindFirstMock = vi.fn();
    const auditLogCreateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_self',
            cycle_id: 'cycle_self',
            assigned_to: 'user_1',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_self',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'user_1',
                patient: { name: '田中 一郎' },
              },
            },
          }),
          update: vi.fn(),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_1' }]),
        },
        membership: {
          findFirst: membershipFindFirstMock,
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        auditLog: { create: auditLogCreateMock },
        medicationCycle: {
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: { create: vi.fn() },
        workflowException: { create: vi.fn(), updateMany: vi.fn() },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_self',
        result: 'approved',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      message: '自己監査（調剤者=監査者）の例外には理由の記録が必須です',
    });
    // two-person rule 保護: 監査レコード・操作証跡は作らない
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects a self-audit with 403 when the operator lacks admin approval', async () => {
    const dispenseAuditCreateMock = vi.fn();
    // 自己監査だが admin 権限なし → membership.findFirst が null を返す
    const membershipFindFirstMock = vi.fn().mockResolvedValue(null);
    const auditLogCreateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_self',
            cycle_id: 'cycle_self',
            assigned_to: 'user_1',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_self',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'user_1',
                patient: { name: '田中 一郎' },
              },
            },
          }),
          update: vi.fn(),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_1' }]),
        },
        membership: {
          findFirst: membershipFindFirstMock,
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        auditLog: { create: auditLogCreateMock },
        medicationCycle: {
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: { create: vi.fn() },
        workflowException: { create: vi.fn(), updateMany: vi.fn() },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_self',
        result: 'approved',
        same_operator_reason: '単独勤務のため自己監査',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: '自己監査（調剤者=監査者）の例外は管理者のみ承認できます',
    });
    expect(membershipFindFirstMock).toHaveBeenCalled();
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('stores external packaging-audit metadata in reject_detail', async () => {
    const dispenseAuditCreateMock = vi.fn().mockResolvedValue({
      id: 'audit_3',
      result: 'hold',
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_3',
            cycle_id: 'cycle_3',
            assigned_to: 'user_dispense',
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: 'patient_3',
              overall_status: 'audit_pending',
              set_plans: [],
              case_: {
                primary_pharmacist_id: 'pharmacist_1',
                patient: {
                  name: '鈴木 一郎',
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense' }]),
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseAuditCreateMock,
        },
        medicationCycle: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_3', overall_status: 'audit_pending', version: 1 }),
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_3', overall_status: 'on_hold' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_3',
        result: 'hold',
        reject_detail: '画像差異を再確認',
        external_audit: {
          adapter: 'PROOFIT',
          external_id: 'proofit-001',
          image_check_result: 'warning',
          image_check_summary: '1包だけOCR一致率が低い',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reject_detail: expect.stringContaining('[external_audit] adapter=PROOFIT'),
      }),
    });
  });
});
