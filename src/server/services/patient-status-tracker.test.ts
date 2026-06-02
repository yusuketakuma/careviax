import { describe, expect, it, vi } from 'vitest';

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
    },
  };
}

describe('trackPatientStatusChanges', () => {
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
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'patient_status_urgent',
          message: '要確認 → 要対応',
        }),
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
});
