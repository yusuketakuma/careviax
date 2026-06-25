import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listPatientRiskSummariesMock } = vi.hoisted(() => ({
  listPatientRiskSummariesMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: listPatientRiskSummariesMock,
}));

import { trackPatientStatusChanges } from './patient-status-tracker';

type TrackerDb = Parameters<typeof trackPatientStatusChanges>[0];

function highRiskPatientSummary() {
  return {
    patient_id: 'patient_1',
    patient_name: '田中 太郎',
    score: 8,
    level: 'high' as const,
    reasons: [],
    unresolved_self_reports: 0,
    open_issues: 0,
    disrupted_visits_30d: 0,
    pending_reports: 0,
    open_tasks: 0,
    missing_visit_consent: false,
    missing_management_plan: false,
  };
}

function makeDb(previousStatusLogs: Array<{ target_id: string; changes: unknown }>) {
  return {
    careCase: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    // 直近ステータス変更は ROW_NUMBER() window query(raw SQL)で取得する。
    $queryRaw: vi.fn().mockResolvedValue(previousStatusLogs),
    notification: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('trackPatientStatusChanges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips malformed latest audit-log status values and uses the latest valid status', async () => {
    listPatientRiskSummariesMock.mockResolvedValue([highRiskPatientSummary()]);
    const db = makeDb([
      { target_id: 'patient_1', changes: { to: 'not_a_status' } },
      { target_id: 'patient_1', changes: { to: 'attention' } },
    ]);

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([
      {
        patientId: 'patient_1',
        patientName: '田中 太郎',
        from: 'attention',
        to: 'urgent',
      },
    ]);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            from: 'attention',
            from_label: '要確認',
            to: 'urgent',
            to_label: '要対応',
          }),
        }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.not.objectContaining({
            patient_name: '田中 太郎',
          }),
        }),
      }),
    );
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(db.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            event_type: 'patient_status_urgent',
            message: '要確認 → 要対応',
            dedupe_key: 'patient-status:patient_1:attention:urgent:2026-06-16',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('falls back to stable when audit-log changes are not object-shaped', async () => {
    listPatientRiskSummariesMock.mockResolvedValue([highRiskPatientSummary()]);
    const db = makeDb([{ target_id: 'patient_1', changes: ['urgent'] }]);

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed[0]).toMatchObject({
      patientId: 'patient_1',
      from: 'stable',
      to: 'urgent',
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            from: 'stable',
            from_label: '安定',
            to: 'urgent',
          }),
        }),
      }),
    );
  });

  it('encodes only the notification link path segment while preserving raw patient identity fields', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        ...highRiskPatientSummary(),
        patient_id: rawPatientId,
      },
    ]);
    const db = makeDb([{ target_id: rawPatientId, changes: { to: 'attention' } }]);

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([
      {
        patientId: rawPatientId,
        patientName: '田中 太郎',
        from: 'attention',
        to: 'urgent',
      },
    ]);
    expect(result.notifications).toEqual([
      {
        patientId: rawPatientId,
        patientName: '田中 太郎',
        severity: 'urgent',
        title: '田中 太郎が要対応になりました',
      },
    ]);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target_id: rawPatientId,
        }),
      }),
    );
    expect(db.careCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [rawPatientId] },
        }),
      }),
    );
    // perf: 訪問の所属判定は visitSchedule を全件取得せず、careCase 側の some(EXISTS)で問い合わせる。
    // visitSchedule.findMany を使うと患者あたりの訪問件数ぶん行が膨らむため、呼ばれてはならない。
    expect(db.visitSchedule.findMany).not.toHaveBeenCalled();
    // completed 訪問の所属(EXISTS)が patient で絞り込まれ、patient_id だけを select すること。
    expect(db.careCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [rawPatientId] },
          visit_schedules: {
            some: expect.objectContaining({ org_id: 'org_1', schedule_status: 'completed' }),
          },
        }),
        select: { patient_id: true },
      }),
    );
    // 予定(gte)/期限切れ(lt)の所属クエリも some(EXISTS)で問い合わせる。
    expect(db.careCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [rawPatientId] },
          visit_schedules: {
            some: expect.objectContaining({
              org_id: 'org_1',
              scheduled_date: expect.objectContaining({ gte: expect.anything() }),
            }),
          },
        }),
      }),
    );
    expect(db.careCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [rawPatientId] },
          visit_schedules: {
            some: expect.objectContaining({
              org_id: 'org_1',
              scheduled_date: expect.objectContaining({ lt: expect.anything() }),
            }),
          },
        }),
      }),
    );
    expect(db.medicationCycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [rawPatientId] },
        }),
      }),
    );
    // 直近ステータスは ROW_NUMBER() window query(raw SQL)で患者ごと直近5件に bound する。
    const queryRawMock = db.$queryRaw as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const querySql = (queryRawMock.mock.calls[0][0] as string[]).join('?');
    expect(querySql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY created_at DESC)',
    );
    expect(querySql).toMatch(/rn\s*<=\s*5\b/);
    expect(querySql).toContain("action = 'patient_status_change'");
    expect(querySql).toContain('org_id = ');
    // bind 変数(injection 不可): org_id と patientIds 配列。生の patient id がそのまま bind される。
    const queryValues = queryRawMock.mock.calls[0].slice(1);
    expect(queryValues[0]).toBe('org_1');
    expect(queryValues[1]).toEqual([rawPatientId]);
    expect(db.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            link: '/patients/patient%2F1%3Ftab%3Dx%23frag',
            dedupe_key: `patient-status:${rawPatientId}:attention:urgent:2026-06-16`,
          }),
        ],
      }),
    );
  });

  it('emits a business-type notification with templated title for a high-severity trigger (overdue_visit)', async () => {
    // level not high + score < 7 to avoid the 'urgent' branch; hasOverdueVisit drives overdue_visit
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        ...highRiskPatientSummary(),
        level: 'watch' as const,
        score: 3,
      },
    ]);
    const db = {
      careCase: {
        // overdue 所属クエリ(visit_schedules.some.scheduled_date < today)に該当患者を返す。
        findMany: vi
          .fn()
          .mockImplementation(
            (args: {
              where?: { visit_schedules?: { some?: { scheduled_date?: { lt?: unknown } } } };
            }) => {
              const some = args?.where?.visit_schedules?.some;
              if (some?.scheduled_date && 'lt' in (some.scheduled_date as object)) {
                return Promise.resolve([{ patient_id: 'patient_1' }]);
              }
              return Promise.resolve([]);
            },
          ),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      // previous status 'attention' is in the trigger's `from` list for overdue_visit
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ target_id: 'patient_1', changes: { to: 'attention' } }]),
      notification: {
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([
      { patientId: 'patient_1', patientName: '田中 太郎', from: 'attention', to: 'overdue_visit' },
    ]);
    expect(result.notifications).toEqual([
      {
        patientId: 'patient_1',
        patientName: '田中 太郎',
        severity: 'high',
        title: '田中 太郎の訪問が遅延しています',
      },
    ]);
    expect(db.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            event_type: 'patient_status_overdue_visit',
            type: 'business',
            title: '田中 太郎の訪問が遅延しています',
            message: '要確認 → 訪問遅延',
            link: '/patients/patient_1',
            is_read: false,
            dedupe_key: 'patient-status:patient_1:attention:overdue_visit:2026-06-16',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('emits the discharged notification on hospitalized -> discharged', async () => {
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        ...highRiskPatientSummary(),
        level: 'stable' as const,
        score: 1,
      },
    ]);
    const db = {
      careCase: { findMany: vi.fn().mockResolvedValue([]) },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: {
        // exception_status 'discharged' drives derivePatientStatusIcon to 'discharged'
        findMany: vi.fn().mockResolvedValue([
          {
            patient_id: 'patient_1',
            exception_status: 'discharged',
            created_at: new Date('2026-01-01T00:00:00Z'),
            overall_status: 'active',
          },
        ]),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ target_id: 'patient_1', changes: { to: 'hospitalized' } }]),
      notification: {
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([
      { patientId: 'patient_1', patientName: '田中 太郎', from: 'hospitalized', to: 'discharged' },
    ]);
    expect(result.notifications).toEqual([
      {
        patientId: 'patient_1',
        patientName: '田中 太郎',
        severity: 'normal',
        title: '田中 太郎が退院しました',
      },
    ]);
    expect(db.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            event_type: 'patient_status_discharged',
            type: 'business',
            title: '田中 太郎が退院しました',
            message: '入院中 → 退院直後',
            dedupe_key: 'patient-status:patient_1:hospitalized:discharged:2026-06-16',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('writes an audit log but emits no notification when the change has no matching trigger (medication_change)', async () => {
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        ...highRiskPatientSummary(),
        level: 'stable' as const,
        score: 1,
      },
    ]);
    const db = {
      careCase: {
        // completed 所属クエリ(visit_schedules.some.schedule_status==='completed')に該当患者を返す。
        // これで 'new'/'first_visit_soon' に落ちず medication_change を検証できる。
        findMany: vi
          .fn()
          .mockImplementation(
            (args: { where?: { visit_schedules?: { some?: { schedule_status?: unknown } } } }) => {
              if (args?.where?.visit_schedules?.some?.schedule_status === 'completed') {
                return Promise.resolve([{ patient_id: 'patient_1' }]);
              }
              return Promise.resolve([]);
            },
          ),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: {
        // recent (within 7d) non-intake cycle drives hasRecentMedChange -> 'medication_change'
        findMany: vi.fn().mockResolvedValue([
          {
            patient_id: 'patient_1',
            exception_status: null,
            created_at: new Date('2026-06-15T00:00:00Z'),
            overall_status: 'active',
          },
        ]),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      notification: {
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([
      { patientId: 'patient_1', patientName: '田中 太郎', from: 'stable', to: 'medication_change' },
    ]);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(result.notifications).toEqual([]);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('writes neither an audit log nor a notification when currentStatus equals previousStatus', async () => {
    // low-risk patient with a completed visit derives to 'stable', matching the default previous status
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        ...highRiskPatientSummary(),
        level: 'stable' as const,
        score: 0,
      },
    ]);
    const db = {
      careCase: {
        // completed 所属クエリに該当患者を返し、low-risk が 'stable' に落ちることを検証する。
        findMany: vi
          .fn()
          .mockImplementation(
            (args: { where?: { visit_schedules?: { some?: { schedule_status?: unknown } } } }) => {
              if (args?.where?.visit_schedules?.some?.schedule_status === 'completed') {
                return Promise.resolve([{ patient_id: 'patient_1' }]);
              }
              return Promise.resolve([]);
            },
          ),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      notification: {
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await trackPatientStatusChanges(db as unknown as TrackerDb, {
      orgId: 'org_1',
      actorId: 'user_1',
    });

    expect(result.changed).toEqual([]);
    expect(result.notifications).toEqual([]);
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
});
