import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleCountMock,
  visitScheduleFindManyMock,
  careReportFindManyMock,
  prescriptionIntakeFindManyMock,
  taskGroupByMock,
  billingCandidateCountMock,
  visitScheduleOverrideCountMock,
  careCaseFindManyMock,
  patientFindManyMock,
  communicationQueueMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  billingCandidateCountMock: vi.fn(),
  visitScheduleOverrideCountMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  communicationQueueMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
      findMany: visitScheduleFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    task: {
      groupBy: taskGroupByMock,
    },
    billingCandidate: {
      count: billingCandidateCountMock,
    },
    visitScheduleOverride: {
      count: visitScheduleOverrideCountMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: communicationQueueMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/dashboard/today GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleCountMock
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        scheduled_date: new Date('2026-03-27T00:00:00Z'),
        time_window_start: new Date('1970-01-01T09:00:00Z'),
        schedule_status: 'planned',
        route_order: 1,
        confirmed_at: new Date('2026-03-26T10:00:00Z'),
        carry_items_status: 'partial',
        preparation: {
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: false,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1' }],
          },
        },
      },
    ]);
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_1',
        report_type: 'physician_report',
        status: 'draft',
        created_at: new Date('2026-03-26T00:00:00Z'),
        updated_at: new Date('2026-03-26T00:00:00Z'),
        delivery_records: [{ status: 'draft' }],
      },
    ]);
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        source_type: 'refill',
        prescribed_date: new Date('2026-03-20T00:00:00Z'),
        prescription_expiry_date: null,
        refill_next_dispense_date: new Date('2026-03-30T00:00:00Z'),
        split_dispense_total: null,
        split_dispense_current: null,
        split_next_dispense_date: null,
        cycle: {
          case_: {
            patient: {
              name: '山田 太郎',
            },
          },
        },
      },
    ]);
    taskGroupByMock.mockResolvedValue([
      { task_type: 'visit_preparation', _count: { id: 2 } },
      { task_type: 'billing_evidence_review', _count: { id: 3 } },
    ]);
    billingCandidateCountMock.mockResolvedValue(4);
    visitScheduleOverrideCountMock.mockResolvedValue(1);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '山田 太郎' }]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 2,
        overdue_count: 1,
        self_reports: 1,
        callback_followups: 1,
        open_requests: 0,
        delivery_backlog: 1,
        expiring_external_shares: 0,
      },
      items: [
        {
          id: 'queue_1',
          title: '山田 太郎 の自己申告',
          summary: '飲み忘れ',
          channel: 'patient_portal',
          status: 'submitted',
          priority: 'urgent',
          patient_name: '山田 太郎',
        },
      ],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 403 when the role lacks dashboard permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns linked dashboard data for today', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      caseIds: ['case_1'],
      patientIds: ['patient_1'],
      limit: 5,
    });
    expect(visitScheduleCountMock).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        org_id: 'org_1',
        case_id: { in: ['case_1'] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      }),
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [
            { case_id: { in: ['case_1'] } },
            { case_id: null, patient_id: { in: ['patient_1'] } },
          ],
        }),
      }),
    );
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          cycle: { case_id: { in: ['case_1'] } },
        }),
      }),
    );
    expect(taskGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            { assigned_to: 'user_1' },
            { related_entity_type: 'patient', related_entity_id: { in: ['patient_1'] } },
            { related_entity_type: 'case', related_entity_id: { in: ['case_1'] } },
          ]),
        }),
      }),
    );
    expect(billingCandidateCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: { in: ['patient_1'] },
        status: 'candidate',
      },
    });
    expect(visitScheduleOverrideCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [
          { source_schedule: { case_id: { in: ['case_1'] } } },
          { replacement_schedule: { case_id: { in: ['case_1'] } } },
        ],
        status: 'pending',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      visits: {
        total: 10,
        completed: 4,
        pending: 6,
      },
      tasks: {
        open: 5,
      },
      today_visits: [
        expect.objectContaining({
          patient_name: '山田 太郎',
          carry_items_status: 'partial',
        }),
      ],
      reports_backlog: [
        expect.objectContaining({
          patient_name: '山田 太郎',
          report_type: 'physician_report',
        }),
      ],
      communication_queue: {
        summary: expect.objectContaining({
          pending_count: 2,
        }),
      },
      role_focus: {
        role: 'clerk',
      },
    });
  });
});
