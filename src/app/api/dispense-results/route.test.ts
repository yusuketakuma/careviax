import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock, dispatchNotificationEventMock } = vi.hoisted(() => ({
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

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

const { upsertOperationalTaskMock } = vi.hoisted(() => ({
  upsertOperationalTaskMock: vi.fn().mockResolvedValue({ id: 'task_operational_1' }),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/dispense-results POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks dispense completion when the cycle has an unresolved cycle-level inquiry', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            cycle: {
              id: 'cycle_1',
              inquiries: [
                {
                  id: 'inquiry_1',
                  line_id: null,
                  reason: '相互作用',
                  inquiry_to_physician: '在宅主治医',
                },
              ],
              visit_schedules: [],
            },
          }),
        },
        dispenseResult: { create: vi.fn() },
        medicationCycle: { update: vi.fn() },
        visitSchedule: { update: vi.fn() },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            carry_type: 'carry',
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '疑義照会中のため調剤開始できません',
    });
  });

  it('blocks only the line that still has an unresolved inquiry', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            cycle: {
              id: 'cycle_1',
              inquiries: [
                {
                  id: 'inquiry_1',
                  line_id: 'line_blocked',
                  reason: '用量疑義',
                  inquiry_to_physician: '在宅主治医',
                },
              ],
              visit_schedules: [],
            },
          }),
        },
        dispenseResult: { create: vi.fn() },
        medicationCycle: { update: vi.fn() },
        visitSchedule: { update: vi.fn() },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_blocked',
            actual_drug_name: 'アムロジピン',
            actual_quantity: 14,
            carry_type: 'carry',
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '疑義照会中の明細が含まれているため調剤完了できません',
      details: {
        blocked_lines: [
          {
            line_id: 'line_blocked',
            reason: '用量疑義 / 在宅主治医',
          },
        ],
      },
    });
  });

  it('allows fax-origin prescriptions to complete dispensing and creates a follow-up task for original collection', async () => {
    const dispenseResultCreateMock = vi.fn().mockResolvedValue({
      id: 'result_1',
      line_id: 'line_1',
      actual_drug_name: 'アムロジピン',
      actual_drug_code: '123',
      actual_quantity: 14,
      actual_unit: '錠',
      carry_type: 'carry',
      special_notes: null,
    });
    const dispenseResultFindManyMock = vi.fn().mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: null,
      },
    ]);
    const dispenseTaskUpdateMock = vi.fn().mockResolvedValue({});
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 1,
    });
    const medicationCycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const visitScheduleUpdateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            priority: 'normal',
            results: [],
            cycle: {
              id: 'cycle_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'fax',
                  original_collected_at: null,
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン',
                      drug_code: '123',
                      quantity: 14,
                    },
                  ],
                },
              ],
              visit_schedules: [],
              case_: {
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          findMany: dispenseResultFindManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: {
          findMany: vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]),
        },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            carry_type: 'carry',
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'fax_original_followup',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_1',
      }),
    );
  });

  it('updates visit carry status to partial when deferred lines remain', async () => {
    const dispenseResultCreateMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'result_1',
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: null,
      })
      .mockResolvedValueOnce({
        id: 'result_2',
        line_id: 'line_2',
        actual_drug_name: 'ロキソプロフェン',
        actual_drug_code: '456',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'deferred',
        special_notes: '欠品後送',
      });
    const dispenseResultFindManyMock = vi.fn().mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: null,
      },
      {
        line_id: 'line_2',
        actual_drug_name: 'ロキソプロフェン',
        actual_drug_code: '456',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'deferred',
        special_notes: '欠品後送',
      },
    ]);
    const dispenseTaskUpdateMock = vi.fn().mockResolvedValue({});
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 1,
    });
    const medicationCycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const visitScheduleUpdateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン',
                      drug_code: '123',
                      quantity: 14,
                    },
                    {
                      id: 'line_2',
                      drug_name: 'ロキソプロフェン',
                      drug_code: '456',
                      quantity: 14,
                    },
                  ],
                },
              ],
              visit_schedules: [{ id: 'schedule_1' }],
              case_: {
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          findMany: dispenseResultFindManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // B3
        },
        membership: {
          findMany: vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]),
        },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
          {
            line_id: 'line_2',
            actual_drug_name: 'ロキソプロフェン',
            actual_drug_code: '456',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'deferred',
            discrepancy_reason: '欠品後送',
            special_notes: '欠品後送',
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: expect.objectContaining({
        carry_items_status: 'partial',
      }),
    });
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 1 },
      data: { overall_status: 'audit_pending', version: { increment: 1 } },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'dispense_audit_pending',
        link: '/auditing/task_1',
        explicitUserIds: ['auditor_1'],
      })
    );
  });

  it('requires a discrepancy reason when the dispensed drug differs from the prescription', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン錠5mg',
                      drug_code: '111',
                      quantity: 14,
                    },
                  ],
                },
              ],
              visit_schedules: [],
            },
          }),
        },
        dispenseResult: { create: vi.fn() },
        medicationCycle: { update: vi.fn() },
        visitSchedule: { update: vi.fn() },
      })
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピンOD錠5mg',
            actual_drug_code: '222',
            actual_quantity: 14,
            carry_type: 'carry',
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '差異/欠品/代替がある明細は理由コードを入力してください',
      details: {
        discrepancy_lines: [
          {
            line_id: 'line_1',
            reason: '処方との差異があるため理由コードが必須です',
          },
        ],
      },
    });
  });
});
