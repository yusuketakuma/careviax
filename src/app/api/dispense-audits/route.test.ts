import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/dispense-audits POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a rejected task back to dispensing and notifies the assignee', async () => {
    const taskUpdateMock = vi.fn().mockResolvedValue({});
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
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
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([
            { user_id: 'admin_1' },
            { user_id: 'pharmacist_1' },
          ]),
        },
        dispenseAudit: {
          create: vi.fn().mockResolvedValue({
            id: 'audit_1',
            result: 'rejected',
          }),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
        },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'rejected',
        reject_reason: 'wrong_drug',
        reject_detail: '別規格が混入',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(cycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { overall_status: 'dispensing' },
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
      })
    );
  });

  it('rejects emergency approval for non-admin users without a reason', async () => {
    const response = await POST(
      createRequest({
        task_id: 'task_1',
        result: 'emergency_approved',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '緊急例外承認時は理由の記録が必須です',
    });
  });

  it('moves approved cycles to visit_ready when no set plan exists', async () => {
    const cycleUpdateMock = vi.fn().mockResolvedValue({});

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
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          create: vi.fn().mockResolvedValue({
            id: 'audit_2',
            result: 'approved',
          }),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
        },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_2',
        result: 'approved',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(cycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_2' },
      data: { overall_status: 'visit_ready' },
    });
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
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_admin' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          create: dispenseAuditCreateMock,
        },
        medicationCycle: {
          update: vi.fn().mockResolvedValue({}),
        },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
        },
      })
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
      })
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
