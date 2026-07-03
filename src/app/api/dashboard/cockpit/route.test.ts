import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  medicationCycleGroupByMock,
  dispenseTaskFindManyMock,
  queryRawMock,
  visitScheduleFindManyMock,
  workflowExceptionFindManyMock,
  taskCountMock,
  careCaseFindManyMock,
  membershipFindManyMock,
  pharmacistShiftFindManyMock,
  serverCacheGetMock,
  serverCacheSetMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  medicationCycleGroupByMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  serverCacheGetMock: vi.fn(),
  serverCacheSetMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { groupBy: medicationCycleGroupByMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    $queryRaw: queryRawMock,
    visitSchedule: { findMany: visitScheduleFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
    task: { count: taskCountMock },
    careCase: { findMany: careCaseFindManyMock },
    membership: { findMany: membershipFindManyMock },
    pharmacistShift: { findMany: pharmacistShiftFindManyMock },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/utils/server-cache', () => ({
  serverCache: {
    get: serverCacheGetMock,
    set: serverCacheSetMock,
  },
}));

import { GET } from './route';

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/dashboard/cockpit${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function buildAuditTask(args: {
  id: string;
  priority?: string;
  dueDate?: Date | null;
  audits?: Array<{ result: string }>;
  patientName?: string;
  lineTags?: string[];
  packagingInstructions?: string | null;
}) {
  return {
    id: args.id,
    priority: args.priority ?? 'normal',
    due_date: args.dueDate ?? null,
    updated_at: new Date('2026-06-12T08:00:00'),
    audits: args.audits ?? [],
    cycle: {
      id: `cycle_${args.id}`,
      case_: { patient: { name: args.patientName ?? '患者A' } },
      prescription_intakes: [
        {
          id: `intake_${args.id}`,
          prescribed_date: new Date('2026-06-01T00:00:00'),
          lines: [
            {
              packaging_instruction_tags: args.lineTags ?? [],
              packaging_instructions: args.packagingInstructions ?? null,
              notes: null,
              dispensing_method: null,
            },
          ],
        },
      ],
    },
  };
}

describe('/api/dashboard/cockpit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContextMock });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    serverCacheGetMock.mockReturnValue(undefined);
    authContextMock.role = 'admin';
    medicationCycleGroupByMock.mockResolvedValue([
      { overall_status: 'dispensed', _count: { id: 10 } },
      { overall_status: 'audit_pending', _count: { id: 14 } },
      { overall_status: 'visit_completed', _count: { id: 2 } },
    ]);
    queryRawMock.mockResolvedValue([{ count: BigInt(2) }]);
    dispenseTaskFindManyMock.mockResolvedValue([
      buildAuditTask({
        id: 'task_plain',
        priority: 'urgent',
        dueDate: new Date(2026, 5, 12, 11, 0),
        patientName: '佐々木 ハル',
      }),
      buildAuditTask({
        id: 'task_narcotic',
        priority: 'normal',
        dueDate: new Date(2026, 5, 12, 12, 0),
        patientName: '田中 一郎',
        lineTags: ['narcotic'],
        packagingInstructions: '冷所保管',
      }),
      buildAuditTask({
        id: 'task_done',
        audits: [{ result: 'approved' }],
      }),
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        // @db.Time は壁時計を UTC parts に格納する(Date.UTC で表現)。
        time_window_start: new Date(Date.UTC(2026, 5, 12, 10, 30)),
        time_window_end: new Date(Date.UTC(2026, 5, 12, 11, 30)),
        facility_batch_id: null,
        case_: { patient: { name: '伊藤' } },
      },
    ]);
    workflowExceptionFindManyMock.mockResolvedValue([
      {
        id: 'exception_1',
        exception_type: 'missing_visit_consent',
        description: 'ご家族の同意待ち(新規契約)',
        severity: 'critical',
        created_at: new Date(2026, 5, 11, 9, 42),
      },
      {
        id: 'exception_2',
        exception_type: 'unknown_type',
        description: '送付先の確認(やまもと内科)',
        severity: 'warning',
        created_at: new Date(2026, 5, 12, 9, 12),
      },
    ]);
    taskCountMock.mockResolvedValue(2);
    careCaseFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist', user: { name: '山田 太郎' } },
      { user_id: 'user_2', role: 'clerk', user: { name: '鈴木 さくら' } },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cockpit aggregate with narcotics-first audit queue', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    const json = await response.json();

    expect(json.data.cycle_status_counts).toEqual({
      dispensed: 10,
      audit_pending: 14,
      visit_completed: 2,
    });

    // チームの余白: 薬剤師 → 事務の順、シフト未登録は 9:00-18:00 勤務扱い(now=9:42)
    expect(json.data.team_capacity).toEqual([
      expect.objectContaining({ user_id: 'user_1', role_label: '薬', status: 'working' }),
      expect.objectContaining({ user_id: 'user_2', role_label: '事務', status: 'working' }),
    ]);

    // 監査済み(approved)タスクは除外され、麻薬を含むタスクが先頭に並ぶ
    expect(json.data.audit_pending_count).toBe(2);
    expect(json.data.audit_queue_total_count).toBe(2);
    expect(json.data.audit_queue_visible_count).toBe(2);
    expect(json.data.audit_queue_hidden_count).toBe(0);
    expect(json.data.narcotic_audit_count).toBe(1);
    expect(json.data.audit_queue.map((item: { task_id: string }) => item.task_id)).toEqual([
      'task_narcotic',
      'task_plain',
    ]);
    expect(json.data.audit_queue[0]).toMatchObject({
      patient_name: '田中 一郎',
      has_narcotic: true,
      handling_tags: ['narcotic', 'cold_storage'],
      intake_id: 'intake_task_narcotic',
      prescribed_date: '2026-06-01',
    });

    expect(json.data.today_visits).toEqual([
      {
        id: 'visit_1',
        patient_name: '伊藤',
        visit_type: 'regular',
        schedule_status: 'planned',
        // 壁時計 "HH:MM" でシリアライズ(TZ 非依存; client は再パースしない)。
        time_start: '10:30',
        time_end: '11:30',
        facility_batch_id: null,
      },
    ]);

    expect(json.data.blocked_reasons).toEqual([
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'critical',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ]);

    expect(json.data.carryover_count).toBe(2);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:admin:user_1:2026-06-12:team'),
      expect.objectContaining({
        audit_pending_count: 2,
        audit_queue_total_count: 2,
        audit_queue_visible_count: 2,
        audit_queue_hidden_count: 0,
      }),
      15_000,
    );
  });

  it('keeps the visible audit queue capped while reporting the exact total count', async () => {
    queryRawMock.mockResolvedValueOnce([{ count: BigInt(37) }]);
    dispenseTaskFindManyMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) =>
        buildAuditTask({
          id: `task_${index}`,
          priority: index === 0 ? 'emergency' : 'normal',
          dueDate: new Date(2026, 5, 12, 10, index),
          patientName: `患者${index}`,
        }),
      ),
    );

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.audit_pending_count).toBe(37);
    expect(json.data.audit_queue_total_count).toBe(37);
    expect(json.data.audit_queue_visible_count).toBe(5);
    expect(json.data.audit_queue_hidden_count).toBe(32);
    expect(json.data.audit_queue).toHaveLength(5);

    const auditQuery = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0];
    expect(auditQuery?.take).toBe(30);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('serves a cached cockpit response without rerunning aggregate queries', async () => {
    serverCacheGetMock.mockReturnValueOnce({
      generated_at: '2026-06-12T00:00:00.000Z',
      scope: { requested: 'team', applied: 'team', can_view_team: true },
      cycle_status_counts: { audit_pending: 1 },
      audit_pending_count: 1,
      narcotic_audit_count: 0,
      audit_queue: [],
      today_visits: [],
      blocked_reasons: [],
      carryover_count: 0,
      team_capacity: [],
    });

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { cycle_status_counts: { audit_pending: 1 } },
    });
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
  });

  it('uses the personal assignment scope when an admin requests mine', async () => {
    authContextMock.role = 'admin';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_admin_1', patient_id: 'patient_admin_1' }]);

    const response = (await GET(createRequest('?scope=mine'), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'mine',
      applied: 'mine',
      can_view_team: true,
    });
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const cycleWhere = medicationCycleGroupByMock.mock.calls.at(-1)?.[0]?.where;
    expect(cycleWhere?.case_id).toEqual({ in: ['case_admin_1'] });

    const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
    expect(taskWhere?.OR).toEqual([
      { assigned_to: 'user_1' },
      { related_entity_type: 'patient', related_entity_id: { in: ['patient_admin_1'] } },
      { related_entity_type: 'case', related_entity_id: { in: ['case_admin_1'] } },
    ]);
  });

  it('falls back to mine when a non-admin requests team scope', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GET(createRequest('?scope=team'), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json.data.scope).toEqual({
      requested: 'team',
      applied: 'mine',
      can_view_team: false,
    });
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const auditWhere = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(auditWhere?.cycle).toEqual({ case_id: { in: ['case_1'] } });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(serverCacheSetMock).toHaveBeenCalledWith(
      expect.stringContaining('cockpit:org_1:pharmacist:user_1:2026-06-12:mine'),
      expect.objectContaining({
        scope: { requested: 'team', applied: 'mine', can_view_team: false },
      }),
      15_000,
    );
  });

  it('JST でも scheduled_date(@db.Date)は UTC レンジ、created_at(DateTime)はローカル深夜で比較する', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);

      const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(visitWhere?.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(visitWhere?.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');

      // 繰越タスク(created_at, 実時刻)は JST 当日開始の実時刻(JST 0:00 = 前日 15:00Z)
      const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
      expect(taskWhere?.created_at.lt.toISOString()).toBe('2026-06-11T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('UTC ランタイム(prod)の JST 早朝でも繰越タスクは JST 当日開始の実時刻で数える(CE03)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。
      // 旧実装(setHours ローカル深夜)は UTC 深夜 2026-06-11T00:00Z を境界にし、
      // JST 当日早朝に作られたタスクを繰越に誤カウントしていた。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);

      // @db.Date(scheduled_date)は JST 当日の UTC 深夜レンジ
      const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(visitWhere?.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(visitWhere?.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');

      // created_at(実時刻)は JST 当日開始の実時刻(= 2026-06-11T15:00Z)。旧実装は 2026-06-11T00:00Z。
      const taskWhere = taskCountMock.mock.calls.at(-1)?.[0]?.where;
      expect(taskWhere?.created_at.lt.toISOString()).toBe('2026-06-11T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('scopes queries by assigned care cases for non-admin members', async () => {
    authContextMock.role = 'pharmacist';
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const cycleWhere = medicationCycleGroupByMock.mock.calls.at(-1)?.[0]?.where;
    expect(cycleWhere?.case_id).toEqual({ in: ['case_1'] });

    const auditWhere = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(auditWhere?.cycle).toEqual({ case_id: { in: ['case_1'] } });

    const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(visitWhere?.case_id).toEqual({ in: ['case_1'] });
  });

  it.each([
    ['?scope=', 'scope が不正です'],
    ['?scope=%20team', 'scope が不正です'],
    ['?scope=mine%20', 'scope が不正です'],
    ['?scope=all', 'scope が不正です'],
  ])('rejects malformed scope query "%s" before cache or DB reads', async (search, message) => {
    const response = (await GET(createRequest(search), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        scope: [message],
      },
    });
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate scope query before cache or DB reads', async () => {
    const response = (await GET(createRequest('?scope=mine&scope=team'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        scope: ['scope は1つだけ指定してください'],
      },
    });
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('wraps auth failure responses in no-store headers before cache or DB reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(serverCacheGetMock).not.toHaveBeenCalled();
    expect(serverCacheSetMock).not.toHaveBeenCalled();
    expect(medicationCycleGroupByMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when cockpit aggregate reads fail', async () => {
    const unsafeError = new Error(
      'raw_patient_secret raw_dashboard_secret SQL_SECRET stack_secret raw-error text',
    );
    unsafeError.name = 'crafted.raw_patient_secret.raw_dashboard_secret.SQL_SECRET.stack_secret';
    medicationCycleGroupByMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw_patient_secret');
    expect(body).not.toContain('raw_dashboard_secret');
    expect(body).not.toContain('SQL_SECRET');
    expect(body).not.toContain('stack_secret');
    expect(body).not.toContain('crafted.raw_patient_secret');
    expect(body).not.toContain('raw-error text');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_cockpit_unhandled_error',
        route: '/api/dashboard/cockpit',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, loggedError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    expect(loggedError).toBe(unsafeError);
    const logged = JSON.stringify(routeContext);
    expect(logged).not.toContain('raw_patient_secret');
    expect(logged).not.toContain('raw_dashboard_secret');
    expect(logged).not.toContain('SQL_SECRET');
    expect(logged).not.toContain('stack_secret');
    expect(logged).not.toContain('raw-error text');
    expect(logged).not.toContain(unsafeError.name);
  });
});
