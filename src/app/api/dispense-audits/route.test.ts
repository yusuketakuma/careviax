import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  notifyWorkflowMutationMock,
  dispenseTaskFindManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        } as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
    },
  ),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      findMany: dispenseTaskFindManyMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

function createGetRequest() {
  return {
    url: 'http://localhost/api/dispense-audits',
  } as NextRequest;
}

const expectedCycleAssignmentWhere = {
  case_: {
    OR: [
      { primary_pharmacist_id: 'user_1' },
      { backup_pharmacist_id: 'user_1' },
      { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
    ],
  },
};

describe('/api/dispense-audits GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    ]);
  });

  it('shows hold items again and excludes already approved audits', async () => {
    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ id: string; facility_label: string | null; is_overdue: boolean }>;
    };
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: 'task_hold',
        facility_label: 'facility_1',
        is_overdue: true,
      }),
    ]);
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
          cycle: expectedCycleAssignmentWhere,
        },
      }),
    );
  });
});

describe('/api/dispense-audits POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a rejected task back to dispensing and notifies the assignee', async () => {
    const taskUpdateMock = vi.fn().mockResolvedValue({});
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending', version: 1 });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const workflowExceptionCreateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            assigned_to: 'user_dispense',
            due_date: new Date('2026-03-29T00:00:00.000Z'),
            priority: 'urgent',
            cycle: {
              patient_id: 'patient_1',
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
          findMany: vi
            .fn()
            .mockResolvedValue([{ user_id: 'admin_1' }, { user_id: 'pharmacist_1' }]),
        },
        dispenseAudit: {
          create: vi.fn().mockResolvedValue({ id: 'audit_1', result: 'rejected' }),
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
        reject_detail: '別規格が混入',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(cycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 1 },
      data: { overall_status: 'dispensing', version: { increment: 1 } },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'in_progress' },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalled();
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'dispense_audit_rejected',
        link: '/dispensing/task_1',
        explicitUserIds: expect.arrayContaining(['user_dispense', 'pharmacist_1', 'admin_1']),
      }),
    );
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
          cycle: expectedCycleAssignmentWhere,
        },
      }),
    );
    expect(dispenseResultFindManyMock).not.toHaveBeenCalled();
    expect(dispenseAuditCreateMock).not.toHaveBeenCalled();
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
