import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  membershipFindManyMock,
  taskGroupByMock,
  taskFindManyMock,
  taskQueryRawMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  membershipFindManyMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskQueryRawMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskGroupByMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findMany: membershipFindManyMock,
    },
    task: {
      groupBy: taskGroupByMock,
      findMany: taskFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    dispenseTask: {
      groupBy: dispenseTaskGroupByMock,
    },
    $queryRaw: taskQueryRawMock,
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/staff-workload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(authContext, {
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
    });
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    membershipFindManyMock.mockResolvedValue([
      {
        role: 'pharmacist',
        can_audit_dispense: true,
        user: { id: 'user_1', name: '現在の薬剤師' },
      },
      {
        role: 'pharmacist',
        can_audit_dispense: true,
        user: { id: 'user_a', name: '山田 薬剤師' },
      },
      {
        role: 'clerk',
        can_audit_dispense: false,
        user: { id: 'user_b', name: '佐藤 事務' },
      },
    ]);
    taskGroupByMock.mockResolvedValue([
      { assigned_to: 'user_a', _count: { id: 2 } },
      { assigned_to: 'user_b', _count: { id: 1 } },
    ]);
    taskFindManyMock.mockResolvedValue([]);
    taskQueryRawMock.mockResolvedValue([
      {
        id: 'task_1',
        assigned_to: 'user_a',
        title: '鈴木さんの監査をしてほしい',
        task_type: 'staff_work_request_audit',
        priority: 'high',
        status: 'pending',
        due_date: new Date('2026-06-15T14:59:00.000Z'),
        sla_due_at: null,
      },
      {
        id: 'task_2',
        assigned_to: 'user_a',
        title: '訪問前の確認',
        task_type: 'visit_preparation',
        priority: 'normal',
        status: 'pending',
        due_date: new Date('2026-06-16T14:59:00.000Z'),
        sla_due_at: null,
      },
      {
        id: 'task_3',
        assigned_to: 'user_a',
        title: '残薬連絡',
        task_type: 'medication_followup',
        priority: 'normal',
        status: 'in_progress',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_4',
        assigned_to: 'user_a',
        title: '報告書確認',
        task_type: 'care_report_review',
        priority: 'low',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_5',
        assigned_to: 'user_a',
        title: 'SQL 側の上限を超えたタスク',
        task_type: 'should_not_render',
        priority: 'low',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_6',
        assigned_to: 'user_b',
        title: '配送確認',
        task_type: 'delivery_check',
        priority: 'normal',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        pharmacist_id: 'user_a',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: null,
        case_: { patient: { name: '田中 花子' } },
      },
    ]);
    dispenseTaskGroupByMock.mockResolvedValue([{ assigned_to: 'user_a', _count: { id: 3 } }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        membership: { findMany: membershipFindManyMock },
        task: {
          groupBy: taskGroupByMock,
          findMany: taskFindManyMock,
        },
        $queryRaw: taskQueryRawMock,
        visitSchedule: { findMany: visitScheduleFindManyMock },
        dispenseTask: { groupBy: dispenseTaskGroupByMock },
      }),
    );
  });

  it('returns staff workload grouped by active staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: 'スタッフ業務量の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          is_active: true,
          user: { is_active: true, account_status: 'active' },
        }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          pharmacist_id: { in: ['user_1', 'user_a', 'user_b'] },
          scheduled_date: {
            gte: new Date('2026-06-15T00:00:00.000Z'),
            lt: new Date('2026-06-16T00:00:00.000Z'),
          },
        }),
        select: {
          id: true,
          pharmacist_id: true,
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
    );
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskQueryRawMock).toHaveBeenCalledTimes(1);
    const [query, orgId, assignedStaffIds, limit] = taskQueryRawMock.mock.calls[0] ?? [];
    const queryText = Array.from(query as TemplateStringsArray).join(' ');
    expect(queryText).toContain('ROW_NUMBER() OVER');
    expect(queryText).toContain('PARTITION BY assigned_to');
    expect(queryText).toContain('sla_due_at ASC NULLS LAST');
    expect(queryText).toContain('due_date ASC NULLS LAST');
    expect(queryText).toContain('org_id =');
    expect(queryText).toContain('assigned_to = ANY(');
    expect(queryText).toContain("status IN ('pending', 'in_progress')");
    expect(queryText).toContain('WHERE rn <=');
    expect(orgId).toBe('org_1');
    expect(assignedStaffIds).toEqual(['user_1', 'user_a', 'user_b']);
    expect(limit).toBe(2);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({ meta: { date: '2026-06-15' } });
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'user_a',
          name: '山田 薬剤師',
          role_label: '薬剤師',
          assignable_work_request_types: [],
          open_task_count: 2,
          today_visit_count: 1,
          dispense_task_count: 3,
          open_tasks: [
            { id: 'task_1', title: '鈴木さんの監査をしてほしい' },
            { id: 'task_2', title: '訪問前の確認' },
          ],
          visits: [{ id: 'visit_1', patient_name: '田中 花子' }],
        }),
        expect.objectContaining({
          id: 'user_b',
          name: '佐藤 事務',
          role_label: '事務スタッフ',
          assignable_work_request_types: [],
          open_task_count: 1,
          open_tasks: [{ id: 'task_6', title: '配送確認' }],
        }),
      ]),
    );
    expect(payload.data[0].open_tasks).toHaveLength(2);
    expect(Object.keys(payload.data[0].open_tasks[0]).sort()).toEqual(['id', 'title']);
    expect(Object.keys(payload.data[0].visits[0]).sort()).toEqual(['id', 'patient_name']);
  });

  it('keeps workload rows while projecting owner-visible assignee capability by task type', async () => {
    Object.assign(authContext, {
      orgId: 'org_1',
      userId: 'owner_1',
      role: 'owner',
    });
    membershipFindManyMock.mockResolvedValueOnce([
      {
        role: 'owner',
        can_audit_dispense: true,
        user: { id: 'owner_1', name: '現在の責任者' },
      },
      {
        role: 'pharmacist',
        can_audit_dispense: true,
        user: { id: 'user_a', name: '山田 薬剤師' },
      },
      {
        role: 'clerk',
        can_audit_dispense: false,
        user: { id: 'user_b', name: '佐藤 事務' },
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'user_a',
          role: 'pharmacist',
          assignable_work_request_types: [
            'staff_work_request_visit',
            'staff_work_request_audit',
            'staff_work_request_general',
          ],
        }),
        expect.objectContaining({
          id: 'user_b',
          role: 'clerk',
          assignable_work_request_types: ['staff_work_request_general'],
        }),
      ]),
    );
  });

  it('projects mixed multi-site roles once and denies assignment without dropping role rows', async () => {
    Object.assign(authContext, {
      orgId: 'org_1',
      userId: 'owner_1',
      role: 'owner',
    });
    membershipFindManyMock.mockResolvedValueOnce([
      {
        role: 'owner',
        can_audit_dispense: true,
        user: { id: 'owner_1', name: '現在の責任者' },
      },
      {
        role: 'pharmacist',
        can_audit_dispense: true,
        user: { id: 'multi_1', name: '複数所属スタッフ' },
      },
      {
        role: 'external_viewer',
        can_audit_dispense: false,
        user: { id: 'multi_1', name: '複数所属スタッフ' },
      },
      {
        role: 'external_viewer',
        can_audit_dispense: false,
        user: { id: 'external_only', name: '外部閲覧者' },
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    const membershipQuery = membershipFindManyMock.mock.calls[0]?.[0];
    expect(membershipQuery.where).not.toHaveProperty('role');
    const payload = await response.json();
    expect(payload.data.filter((staff: { id: string }) => staff.id === 'multi_1')).toEqual([
      expect.objectContaining({
        role: 'multiple',
        role_label: '薬剤師・外部連携者',
        assignable_work_request_types: [],
      }),
    ]);
    expect(payload.data.some((staff: { id: string }) => staff.id === 'external_only')).toBe(false);
  });

  it('projects only the caller row for a trainee personal assignment scope', async () => {
    Object.assign(authContext, {
      orgId: 'org_1',
      userId: 'trainee_1',
      role: 'pharmacist_trainee',
    });
    membershipFindManyMock.mockResolvedValueOnce([
      {
        role: 'pharmacist_trainee',
        can_audit_dispense: false,
        user: { id: 'trainee_1', name: '佐藤 研修薬剤師' },
      },
      {
        role: 'pharmacist',
        can_audit_dispense: true,
        user: { id: 'pharmacist_2', name: '山田 薬剤師' },
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'trainee_1',
          assignable_work_request_types: ['staff_work_request_visit', 'staff_work_request_general'],
        }),
        expect.objectContaining({
          id: 'pharmacist_2',
          assignable_work_request_types: [],
        }),
      ]),
    );
  });

  it('defaults omitted date to the current Japan business day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z'));

    try {
      const response = await GET(createRequest('http://localhost/api/staff-workload'));
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(200);
      expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scheduled_date: {
              gte: new Date('2026-06-12T00:00:00.000Z'),
              lt: new Date('2026-06-13T00:00:00.000Z'),
            },
          }),
        }),
      );
      await expect(response.json()).resolves.toMatchObject({
        meta: { date: '2026-06-12' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an exact dated envelope when no active staff are available', async () => {
    membershipFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toStrictEqual({
      data: [],
      meta: { date: '2026-06-15' },
    });
  });

  it('wraps auth failure responses in no-store headers before querying staff', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid date filters before querying staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026/06/15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-existent calendar dates before querying staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-02-31'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'padded date',
      'http://localhost/api/staff-workload?date=%202026-06-15%20',
      { date: ['date は YYYY-MM-DD で指定してください'] },
    ],
    [
      'duplicate date',
      'http://localhost/api/staff-workload?date=2026-06-15&date=2026-06-16',
      { date: ['date は1つだけ指定してください'] },
    ],
  ])('rejects %s before querying staff', async (_name, url, details) => {
    const response = await GET(createRequest(url));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 envelope when workload reads throw', async () => {
    const thrownError = new Error(
      'patient 田中 花子 task 鈴木さんの監査 failed with SQL SELECT * FROM "Task"; stack line 1',
    );
    thrownError.name = 'PatientName田中Task鈴木SQLStack';
    membershipFindManyMock.mockRejectedValueOnce(thrownError);

    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const responseBody = JSON.stringify(payload);
    expect(responseBody).not.toContain('田中 花子');
    expect(responseBody).not.toContain('鈴木さんの監査');
    expect(responseBody).not.toContain('SELECT * FROM');
    expect(responseBody).not.toContain('stack line');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'staff_workload_unhandled_error',
        route: '/api/staff-workload',
        method: 'GET',
        status: 500,
      },
      thrownError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(thrownError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('田中 花子');
    expect(logged).not.toContain('鈴木さんの監査');
    expect(logged).not.toContain('SELECT * FROM');
    expect(logged).not.toContain('"Task"');
    expect(logged).not.toContain('stack line');
    expect(logged).not.toContain('PatientName田中Task鈴木SQLStack');
  });
});
