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
      findMany: vi.fn().mockResolvedValue(previousStatusLogs),
      create: vi.fn().mockResolvedValue({}),
    },
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
      careCase: { findMany: vi.fn().mockResolvedValue([]) },
      visitSchedule: {
        findMany: vi.fn().mockImplementation((args: { where?: { schedule_status?: unknown; scheduled_date?: { lt?: unknown } } }) => {
          // overdueVisits query: planned-ish status + scheduled_date < today
          const status = args?.where?.schedule_status;
          const isOverdueQuery =
            args?.where?.scheduled_date && 'lt' in (args.where.scheduled_date as object);
          if (status && typeof status === 'object' && isOverdueQuery) {
            return Promise.resolve([{ case_: { patient_id: 'patient_1' } }]);
          }
          return Promise.resolve([]);
        }),
      },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: {
        // previous status 'attention' is in the trigger's `from` list for overdue_visit
        findMany: vi.fn().mockResolvedValue([{ target_id: 'patient_1', changes: { to: 'attention' } }]),
        create: vi.fn().mockResolvedValue({}),
      },
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
        findMany: vi
          .fn()
          .mockResolvedValue([{ target_id: 'patient_1', changes: { to: 'hospitalized' } }]),
        create: vi.fn().mockResolvedValue({}),
      },
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
      careCase: { findMany: vi.fn().mockResolvedValue([]) },
      visitSchedule: {
        // completed visit so we don't fall into 'new'/'first_visit_soon'
        findMany: vi.fn().mockImplementation((args: { where?: { schedule_status?: unknown } }) => {
          if (args?.where?.schedule_status === 'completed') {
            return Promise.resolve([{ case_: { patient_id: 'patient_1' } }]);
          }
          return Promise.resolve([]);
        }),
      },
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
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
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
      careCase: { findMany: vi.fn().mockResolvedValue([]) },
      visitSchedule: {
        findMany: vi.fn().mockImplementation((args: { where?: { schedule_status?: unknown } }) => {
          if (args?.where?.schedule_status === 'completed') {
            return Promise.resolve([{ case_: { patient_id: 'patient_1' } }]);
          }
          return Promise.resolve([]);
        }),
      },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
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
