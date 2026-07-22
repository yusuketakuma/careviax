import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScopedTxRunner } from '@/lib/db/rls';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const getPatientRiskSummaryMock = vi.hoisted(() => vi.fn());
const getPatientVisitBriefMock = vi.hoisted(() => vi.fn());
const getPatientHomeCareFeatureSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: getPatientRiskSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: getPatientVisitBriefMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: getPatientHomeCareFeatureSummaryMock,
}));

import { getPatientTimelineData } from './patient-detail';
import { buildDb, runnerFor, expectPatientTimelineFailureLog } from './patient-detail.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  getPatientRiskSummaryMock.mockResolvedValue({
    level: 'low',
    score: 0,
    factors: [],
  });
  getPatientVisitBriefMock.mockResolvedValue(null);
  getPatientHomeCareFeatureSummaryMock.mockResolvedValue({
    states: [],
    highlights: [],
  });
});

describe('getPatientTimelineData', () => {
  it('renders available timeline sources when one source query fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'normal',
            pharmacist_id: null,
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: null,
          },
        ]),
      },
      communicationEvent: {
        findMany: vi.fn().mockRejectedValue(new Error('communication source unavailable')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'visit_schedule:schedule_1',
          }),
        ]),
      );
      expect(result?.partial_failures).toEqual([
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      expectPatientTimelineFailureLog(consoleErrorSpy, 'communicationEvents');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('formats timeline dates in Asia/Tokyo instead of the server timezone', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T15:30:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'normal',
            pharmacist_id: null,
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: null,
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-03-31T15:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            exclusion_reason: null,
            updated_at: new Date('2026-04-08T08:00:00.000Z'),
          },
        ]),
      },
      medicationCycle: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));

    expect(eventsById.get('visit_schedule:schedule_1')?.summary).toContain('訪問日 2026/04/11');
    expect(eventsById.get('billing_candidate:candidate_1')?.metadata).toContain(
      '算定月 2026/04/01',
    );
    expect(eventsById.get('billing_candidate:candidate_1')?.href).toBe(
      '/billing/candidates?billing_month=2026-04-01&patient_id=patient_1',
    );
    expect(db.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          billing_name: true,
          points: true,
          exclusion_reason: true,
        }),
      }),
    );
    expect(JSON.stringify(result?.timeline_events)).not.toContain('居宅療養管理指導');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('518点');
  });

  it('uses a deterministic id tiebreaker for same-timestamp events', async () => {
    const occurredAt = new Date('2026-04-03T10:00:00.000Z');
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'comm_a',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'A',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
          {
            id: 'comm_b',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'B',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'communication:comm_b',
      'communication:comm_a',
    ]);
  });

  it('limits projected timeline events and the inline operation-history read', async () => {
    const occurredAt = new Date('2026-04-03T10:00:00.000Z');
    const auditLogFindMany = vi.fn().mockResolvedValue([
      {
        id: 'audit_a',
        action: 'patient_profile_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: null,
        changes: {},
        created_at: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        id: 'audit_b',
        action: 'patient_profile_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: null,
        changes: {},
        created_at: new Date('2026-04-04T09:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: { findMany: auditLogFindMany },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'comm_a',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'A',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
          {
            id: 'comm_b',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: 'B',
            counterpart_name: '長女',
            occurred_at: occurredAt,
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 2,
    });

    expect(auditLogFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(result?.timeline_events).toHaveLength(2);
    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'operation_history:audit_a',
      'operation_history:audit_b',
    ]);
  });

  it('passes small caller limits into timeline source reads with a recency buffer', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
    });

    await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 2,
    });

    expect(db.visitRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(db.communicationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(db.patientSelfReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(db.externalAccessGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(db.dispenseResult.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));

    // Child-event/action-sensitive sources keep their original caps. Their
    // newest visible event can be derived from nested delivery records or
    // operation-history actions rather than the parent row order alone, and
    // some of their ids seed the follow-up operation-history filter.
    expect(db.visitSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
    expect(db.patientMcsMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
    expect(db.partnerVisitRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
    expect(db.visitRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
    expect(db.careReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    expect(db.inquiryRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    expect(db.prescriptionIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
    expect(db.firstVisitDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
    expect(db.managementPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6 }));
    expect(db.conferenceNote.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    expect(db.billingCandidate.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
  });

  it('flows every timeline read through the injected scoped executor, never the global prisma', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'export',
            target_type: 'medication_history',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: { export: { target_type: 'medication_history' } },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
    });

    // The runScoped seam records every executor it hands out. Each call must hand
    // `work` the injected `db` executor, never the global `{}` prisma. A generic
    // (non-vi.fn) impl preserves the ScopedTxRunner type parameter.
    const seenExecutors: unknown[] = [];
    let runScopedCallCount = 0;
    const runScoped: ScopedTxRunner = (work) => {
      runScopedCallCount += 1;
      seenExecutors.push(db);
      return work(db as unknown as Prisma.TransactionClient);
    };

    const result = await getPatientTimelineData(runScoped, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    // reads landed on the injected executor's mocks
    expect(db.patient.findFirst).toHaveBeenCalled();
    expect(db.careReport.findMany).toHaveBeenCalled();
    expect(db.auditLog.findMany).toHaveBeenCalled();
    // runScoped invoked once per scoped read; every invocation handed the injected executor
    expect(runScopedCallCount).toBeGreaterThan(0);
    expect(runScopedCallCount).toBe(seenExecutors.length);
    expect(seenExecutors.every((executor) => executor === db)).toBe(true);
    // panel still renders through the scoped seam
    expect(result?.timeline_events.map((item) => item.id)).toEqual(
      expect.arrayContaining(['operation_history:audit_1', 'care_report:report_1']),
    );
    expect(result?.partial_failures).toBeUndefined();
  });

  it('degrades a per-source scoped tx rejection into partial_failures without a 500', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      communicationEvent: {
        // simulate the scoped tx timing out for this source's read
        findMany: vi.fn().mockRejectedValue(new Error('tx timeout')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'care_report:report_1' })]),
      );
      expect(result?.partial_failures).toEqual([
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails soft when the op_history audit-log read rejects: events still render and the failure is surfaced redacted', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockRejectedValue(new Error('audit log query failed')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      // registry events still render despite op_history failure
      expect(result?.timeline_events).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'care_report:report_1' })]),
      );
      // no operation_history events leaked through
      expect(
        result?.timeline_events.some((event) => event.event_type === 'operation_history'),
      ).toBe(false);
      expect(result?.partial_failures).toEqual([
        {
          source: 'operation_history',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      // redaction proof: error.name only, never the raw message
      expectPatientTimelineFailureLog(consoleErrorSpy, 'operation_history');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('audit log query failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails soft when operation actor-name resolution rejects: events render with actor_name null and the failure is surfaced', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'export',
            target_type: 'medication_history',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: { export: { target_type: 'medication_history' } },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
      },
      // operation history still resolves actor ids via user.findMany; reject it
      user: {
        findMany: vi.fn().mockRejectedValue(new Error('user lookup failed')),
      },
    });

    try {
      const result = await getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      });

      const careReportEvent = result?.timeline_events.find(
        (event) => event.id === 'care_report:report_1',
      );
      const operationHistoryEvent = result?.timeline_events.find(
        (event) => event.id === 'operation_history:audit_1',
      );
      // events still render with actor_name null (no whole-panel 500 from name lookup)
      expect(careReportEvent?.actor_name).toBeNull();
      expect(operationHistoryEvent?.actor_name).toBeNull();
      // source marker actors are no longer resolved; only operation-actor failure is surfaced.
      expect(result?.partial_failures).toEqual([
        {
          source: 'operation_actor_names',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ]);
      // redaction proof
      expectPatientTimelineFailureLog(consoleErrorSpy, 'operation_actor_names');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('user lookup failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
