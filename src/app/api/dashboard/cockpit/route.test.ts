import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  medicationCycleGroupByMock,
  dispenseTaskFindManyMock,
  visitScheduleFindManyMock,
  workflowExceptionFindManyMock,
  taskCountMock,
  careCaseFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  medicationCycleGroupByMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { groupBy: medicationCycleGroupByMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    visitSchedule: { findMany: visitScheduleFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
    task: { count: taskCountMock },
    careCase: { findMany: careCaseFindManyMock },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/cockpit', {
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
    authContextMock.role = 'admin';
    medicationCycleGroupByMock.mockResolvedValue([
      { overall_status: 'dispensed', _count: { id: 10 } },
      { overall_status: 'audit_pending', _count: { id: 14 } },
      { overall_status: 'visit_completed', _count: { id: 2 } },
    ]);
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
        time_window_start: new Date(2026, 5, 12, 10, 30),
        time_window_end: new Date(2026, 5, 12, 11, 30),
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cockpit aggregate with narcotics-first audit queue', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.cycle_status_counts).toEqual({
      dispensed: 10,
      audit_pending: 14,
      visit_completed: 2,
    });

    // 監査済み(approved)タスクは除外され、麻薬を含むタスクが先頭に並ぶ
    expect(json.data.audit_pending_count).toBe(2);
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
        time_start: new Date(2026, 5, 12, 10, 30).toISOString(),
        time_end: new Date(2026, 5, 12, 11, 30).toISOString(),
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
  });

  it('JST でも scheduled_date(@db.Date)は UTC レンジ、created_at(DateTime)はローカル深夜で比較する', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);

      const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
      expect(visitWhere?.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(visitWhere?.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');

      // 繰越タスク(created_at, 実時刻)はローカル深夜(JST 0:00 = 前日 15:00Z)のまま
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
    expect(careCaseFindManyMock).toHaveBeenCalled();

    const cycleWhere = medicationCycleGroupByMock.mock.calls.at(-1)?.[0]?.where;
    expect(cycleWhere?.case_id).toEqual({ in: ['case_1'] });

    const auditWhere = dispenseTaskFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(auditWhere?.cycle).toEqual({ case_id: { in: ['case_1'] } });

    const visitWhere = visitScheduleFindManyMock.mock.calls.at(-1)?.[0]?.where;
    expect(visitWhere?.case_id).toEqual({ in: ['case_1'] });
  });
});
