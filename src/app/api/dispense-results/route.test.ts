import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { withAuthMock, withOrgContextMock, dispatchNotificationEventMock, checkDispenseAlertsMock } =
  vi.hoisted(() => ({
    withAuthMock: vi.fn(
      (
        handler: (
          req: NextRequest,
          ctx: { orgId: string; userId: string; role: 'pharmacist' },
        ) => Promise<Response>,
      ) => {
        return (req: NextRequest) =>
          handler(req, {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist' as const,
          });
      },
    ),
    withOrgContextMock: vi.fn(),
    dispatchNotificationEventMock: vi.fn(),
    checkDispenseAlertsMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/cds/checker', () => ({
  checkDispenseAlerts: checkDispenseAlertsMock,
}));

const { upsertOperationalTaskMock } = vi.hoisted(() => ({
  upsertOperationalTaskMock: vi.fn().mockResolvedValue({ id: 'task_operational_1' }),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

const safetyChecklist = {
  patient_identity: true,
  drug_name_strength: true,
  quantity_days: true,
  directions_route: true,
  packaging_storage: true,
  cds_alerts_reviewed: true,
};

const prescriptionQuantityConfirmed = {
  actual_quantity_confirmed: true,
  actual_quantity_source: 'prescription_quantity_confirmed' as const,
};

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function createRequest(body: unknown) {
  const normalizedBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_version' in body)
      ? { ...body, expected_version: 1 }
      : body;
  return createRawRequest(normalizedBody);
}

function createRawRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-results', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/dispense-results', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"task_id":',
  });
}

function mockDispenseTaskForQuantityValidation(args: {
  prescribedQuantity?: number | null;
  prescribedUnit?: string | null;
  results?: Array<{ id: string; line_id: string; actual_quantity: number }>;
}) {
  const dispenseResultCreateMock = vi.fn();
  const dispenseResultUpdateMock = vi.fn();
  const dispenseTaskUpdateMock = vi.fn();
  const visitScheduleUpdateMock = vi.fn();
  const prescribedQuantity = args.prescribedQuantity ?? 14;

  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      dispenseTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'task_1',
          cycle_id: 'cycle_1',
          results:
            args.results?.map((result) => ({
              ...result,
              actual_drug_name: 'アムロジピン',
              actual_drug_code: '123',
              actual_unit: '錠',
              carry_type: 'carry',
              special_notes: null,
            })) ?? [],
          cycle: {
            id: 'cycle_1',
            version: 1,
            patient_id: 'patient_1',
            overall_status: 'dispensing',
            inquiries: [],
            prescription_intakes: [
              {
                id: 'intake_1',
                source_type: 'paper',
                original_collected_at: null,
                lines: [
                  {
                    id: 'line_1',
                    drug_name: 'アムロジピン',
                    drug_code: '123',
                    quantity: prescribedQuantity,
                    unit: args.prescribedUnit ?? '錠',
                  },
                ],
              },
            ],
            visit_schedules: [{ id: 'visit_1', schedule_status: 'planned' }],
            case_: {
              patient: { name: '山田 太郎' },
            },
          },
        }),
        update: dispenseTaskUpdateMock,
      },
      dispenseResult: {
        create: dispenseResultCreateMock,
        update: dispenseResultUpdateMock,
        findMany: vi.fn().mockResolvedValue([]),
      },
      visitSchedule: { update: visitScheduleUpdateMock },
      workflowException: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }),
  );

  return {
    dispenseResultCreateMock,
    dispenseResultUpdateMock,
    dispenseTaskUpdateMock,
    visitScheduleUpdateMock,
  };
}

describe('/api/dispense-results POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDispenseAlertsMock.mockResolvedValue([]);
  });

  it('rejects non-object create payloads before task lookup or safety checks', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before task lookup or safety checks', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('requires expected_version before transaction or notification side effects', async () => {
    const response = await POST(
      createRawRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns 409 WORKFLOW_CONFLICT when expected_version does not match the current cycle version', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              version: 5,
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン',
                      drug_code: '123',
                      quantity: 14,
                      unit: '錠',
                    },
                  ],
                },
              ],
              visit_schedules: [],
              case_: { patient: { name: '山田 太郎' } },
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        expected_version: 3,
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        cycle_id: 'cycle_1',
        expected_version: 3,
        current_version: 5,
      },
    });
    // Stale write must abort before any mutation or CDS check
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('proceeds when expected_version matches the current cycle version', async () => {
    const dispenseResultCreateMock = vi.fn().mockResolvedValue({
      id: 'result_1',
      line_id: 'line_1',
      actual_drug_name: 'アムロジピン',
      actual_drug_code: '123',
      actual_quantity: 12,
      actual_unit: '錠',
      carry_type: 'carry',
      special_notes: null,
    });
    const dispenseResultFindManyMock = vi.fn().mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 12,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: null,
      },
    ]);
    const dispenseTaskUpdateMock = vi.fn().mockResolvedValue({});
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 5,
    });
    const medicationCycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const membershipFindManyMock = vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]);
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_log_1' });

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
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              version: 5,
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン',
                      drug_code: '123',
                      quantity: 14,
                      unit: '錠',
                    },
                  ],
                },
              ],
              visit_schedules: [],
              case_: { patient: { name: '山田 太郎' } },
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
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: { findMany: membershipFindManyMock },
        auditLog: { create: auditLogCreateMock },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        expected_version: 5,
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 12,
            actual_quantity_confirmed: true,
            actual_quantity_source: 'manual_entry',
            carry_type: 'carry',
            discrepancy_reason: '残薬調整',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseResultCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actual_quantity: 12,
        actual_unit: '錠',
        discrepancy_reason: '残薬調整',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            quantity_confirmations: [
              {
                line_id: 'line_1',
                confirmed: true,
                source: 'manual_entry',
              },
            ],
          }),
        }),
      }),
    );
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
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
      }),
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
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
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
      }),
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
      }),
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

  it('requires safety checklist acknowledgement before saving dispense results', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();

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
                  source_type: 'paper',
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
          findMany: vi.fn().mockResolvedValue([]),
        },
        workflowException: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
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
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤結果の保存には患者・薬剤・数量・用法・保管・安全アラートの確認が必要です',
      details: {
        safety_checklist: ['required'],
      },
    });
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('blocks partial dispense result writes when the safety checklist is missing', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
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
          findMany: vi.fn().mockResolvedValue([]),
        },
        workflowException: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
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
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        safety_checklist: ['required'],
      },
    });
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects dispense result writes when the prescribed quantity is unresolved', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();
    const visitScheduleUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              version: 1,
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'アムロジピン',
                      drug_code: '123',
                      quantity: null,
                    },
                  ],
                },
              ],
              visit_schedules: [{ id: 'visit_1', schedule_status: 'planned' }],
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          findMany: vi.fn().mockResolvedValue([]),
        },
        visitSchedule: { update: visitScheduleUpdateMock },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 1,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方数量が未確定の明細があります。処方取込で数量を確認してから調剤完了してください',
      details: {
        unresolved_quantity_lines: [{ line_id: 'line_1', reason: 'prescribed_quantity_required' }],
      },
    });
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing confirmation flag',
      linePatch: {},
      reason: 'actual_quantity_confirmation_required',
    },
    {
      name: 'false confirmation flag',
      linePatch: {
        actual_quantity_confirmed: false,
        actual_quantity_source: 'prescription_quantity_confirmed',
      },
      reason: 'actual_quantity_confirmation_required',
    },
    {
      name: 'missing quantity source',
      linePatch: { actual_quantity_confirmed: true },
      reason: 'actual_quantity_source_required',
    },
  ])(
    'rejects dispense result writes with $name before side effects',
    async ({ linePatch, reason }) => {
      const sideEffects = mockDispenseTaskForQuantityValidation({});

      const response = await POST(
        createRequest({
          task_id: 'task_1',
          safety_checklist: safetyChecklist,
          lines: [
            {
              line_id: 'line_1',
              actual_drug_name: 'アムロジピン',
              actual_drug_code: '123',
              actual_quantity: 14,
              carry_type: 'carry',
              ...linePatch,
            },
          ],
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '調剤実数量の確認元が未確定の明細があります。数量確認後に調剤完了してください',
        details: {
          actual_quantity_confirmation_lines: [{ line_id: 'line_1', reason }],
        },
      });
      expect(sideEffects.dispenseResultCreateMock).not.toHaveBeenCalled();
      expect(sideEffects.dispenseResultUpdateMock).not.toHaveBeenCalled();
      expect(sideEffects.dispenseTaskUpdateMock).not.toHaveBeenCalled();
      expect(sideEffects.visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    },
  );

  it('rejects actual quantity that does not match prescription unit step before side effects', async () => {
    const sideEffects = mockDispenseTaskForQuantityValidation({ prescribedUnit: '包' });

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 12.5,
            actual_quantity_confirmed: true,
            actual_quantity_source: 'manual_entry',
            actual_unit: 'g',
            carry_type: 'carry',
            discrepancy_reason: '残薬調整',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '実数量が単位に合う刻みではありません',
      details: {
        actual_quantity_unit_lines: [
          {
            line_id: 'line_1',
            reason: 'actual_quantity_unit_step_invalid',
            unit: '包',
            step: '1',
          },
        ],
      },
    });
    expect(sideEffects.dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'new line marked as existing result',
      results: [],
      actualQuantity: 14,
      reason: 'existing_result_required',
    },
    {
      name: 'existing result quantity mismatch',
      results: [{ id: 'result_1', line_id: 'line_1', actual_quantity: 12 }],
      actualQuantity: 14,
      reason: 'existing_result_quantity_mismatch',
    },
  ])('rejects $name before side effects', async ({ results, actualQuantity, reason }) => {
    const sideEffects = mockDispenseTaskForQuantityValidation({ results });

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: actualQuantity,
            actual_quantity_confirmed: true,
            actual_quantity_source: 'existing_result',
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        actual_quantity_confirmation_lines: [{ line_id: 'line_1', reason }],
      },
    });
    expect(sideEffects.dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects prescription-confirmed source when actual quantity differs from the current prescription', async () => {
    const sideEffects = mockDispenseTaskForQuantityValidation({});

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 12,
            actual_quantity_confirmed: true,
            actual_quantity_source: 'prescription_quantity_confirmed',
            carry_type: 'carry',
            discrepancy_reason: '残薬調整',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        actual_quantity_confirmation_lines: [
          { line_id: 'line_1', reason: 'prescription_quantity_mismatch' },
        ],
      },
    });
    expect(sideEffects.dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(sideEffects.visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('allows unchanged existing-result quantity resubmits with existing_result source', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseResultUpdateMock = vi.fn().mockResolvedValue({
      id: 'result_1',
      line_id: 'line_1',
      actual_drug_name: 'アムロジピン',
      actual_drug_code: '123',
      actual_quantity: 12,
      actual_unit: '錠',
      carry_type: 'carry',
      special_notes: null,
    });
    const dispenseResultFindManyMock = vi.fn().mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 12,
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
      patient_id: 'patient_1',
    });
    const medicationCycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            priority: 'normal',
            results: [
              {
                id: 'result_1',
                line_id: 'line_1',
                actual_drug_name: 'アムロジピン',
                actual_drug_code: '123',
                actual_quantity: 12,
                actual_unit: '錠',
                carry_type: 'carry',
                special_notes: null,
              },
            ],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
                  lines: [
                    { id: 'line_1', drug_name: 'アムロジピン', drug_code: '123', quantity: 14 },
                  ],
                },
              ],
              visit_schedules: [],
              case_: { patient: { name: '山田 太郎' } },
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          update: dispenseResultUpdateMock,
          findMany: dispenseResultFindManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        visitSchedule: { update: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: { findMany: vi.fn().mockResolvedValue([]) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }) },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 12,
            actual_quantity_confirmed: true,
            actual_quantity_source: 'existing_result',
            carry_type: 'carry',
            discrepancy_reason: '既存実績',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).toHaveBeenCalledWith({
      where: { id: 'result_1' },
      data: expect.objectContaining({
        actual_quantity: 12,
        discrepancy_reason: '既存実績',
      }),
    });
  });

  it('blocks dispense result writes when server-side CDS cannot complete', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();
    checkDispenseAlertsMock.mockRejectedValueOnce(new Error('cds unavailable'));

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
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
          findMany: vi.fn().mockResolvedValue([]),
        },
        workflowException: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message:
        '処方安全チェックを完了できません。禁忌・相互作用・アレルギー等を確認できる状態で再試行してください',
      details: {
        cds_check: ['unavailable'],
      },
    });
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects stale completion transitions before writing dispense results', async () => {
    const dispenseResultCreateMock = vi.fn();
    const dispenseTaskUpdateMock = vi.fn();
    const auditLogCreateMock = vi.fn();
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'audited',
      version: 8,
      patient_id: 'patient_1',
    });
    const medicationCycleUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'audited',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
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
          findMany: vi.fn().mockResolvedValue([]),
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn() },
        workflowException: {
          updateMany: vi.fn(),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'ステータス遷移が不正です: audited → audit_pending',
    });
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(dispenseResultCreateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('converges concurrent first writes to one dispense result per task line', async () => {
    const dispenseResultCreateMock = vi.fn().mockRejectedValueOnce(createUniqueConstraintError());
    const dispenseResultFindFirstMock = vi.fn().mockResolvedValue({ id: 'result_existing' });
    const dispenseResultUpdateMock = vi.fn().mockResolvedValue({
      id: 'result_existing',
      line_id: 'line_1',
      actual_drug_name: 'アムロジピン',
      actual_drug_code: '123',
      actual_quantity: 14,
      actual_unit: null,
      carry_type: 'carry',
      special_notes: null,
    });
    const dispenseResultFindManyMock = vi.fn().mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 14,
        actual_unit: null,
        carry_type: 'carry',
        special_notes: null,
      },
    ]);
    const dispenseTaskUpdateMock = vi.fn().mockResolvedValue({});
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 5,
      patient_id: 'patient_1',
    });
    const medicationCycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

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
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'paper',
                  original_collected_at: null,
                  lines: [
                    { id: 'line_1', drug_name: 'アムロジピン', drug_code: '123', quantity: 14 },
                  ],
                },
              ],
              visit_schedules: [],
              case_: { patient: { name: '山田 太郎' } },
            },
          }),
          update: dispenseTaskUpdateMock,
        },
        dispenseResult: {
          create: dispenseResultCreateMock,
          findFirst: dispenseResultFindFirstMock,
          update: dispenseResultUpdateMock,
          findMany: dispenseResultFindManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        visitSchedule: { update: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: { findMany: vi.fn().mockResolvedValue([]) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }) },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseResultCreateMock).toHaveBeenCalledTimes(1);
    expect(dispenseResultFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_id: 'task_1',
        line_id: 'line_1',
      },
      select: { id: true },
    });
    expect(dispenseResultUpdateMock).toHaveBeenCalledWith({
      where: { id: 'result_existing' },
      data: expect.objectContaining({
        actual_drug_name: 'アムロジピン',
        actual_drug_code: '123',
        actual_quantity: 14,
        carry_type: 'carry',
        dispensed_by: 'user_1',
      }),
    });
    expect(dispenseTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'completed' },
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
    const membershipFindManyMock = vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]);
    const dispensingDecisionUpsertMock = vi.fn().mockResolvedValue({});
    const packagingGroupFindManyMock = vi.fn().mockResolvedValue([{ id: 'group_morning' }]);

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
              patient_id: 'patient_1',
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
        dispensingDecision: {
          upsert: dispensingDecisionUpsertMock,
        },
        packagingGroup: {
          findMany: packagingGroupFindManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            carry_type: 'carry',
            packaging_group_id: 'group_morning',
            packaging_method: 'unit_dose',
            is_unit_dose: true,
            special_notes: '朝食後 一包化',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(packagingGroupFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        id: { in: ['group_morning'] },
      },
      select: { id: true },
    });
    expect(dispensingDecisionUpsertMock).toHaveBeenCalledWith({
      where: {
        task_id_line_id: {
          task_id: 'task_1',
          line_id: 'line_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        task_id: 'task_1',
        line_id: 'line_1',
        dispensing_method: 'unit_dose',
        packaging_method: 'unit_dose',
        packaging_instructions: '朝食後 一包化',
        packaging_group_id: 'group_morning',
        decided_by: 'user_1',
      }),
      update: expect.objectContaining({
        dispensing_method: 'unit_dose',
        packaging_method: 'unit_dose',
        packaging_instructions: '朝食後 一包化',
        packaging_group_id: 'group_morning',
        decided_by: 'user_1',
      }),
    });
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

  it('rejects packaging group ids that do not belong to the current cycle before saving decisions', async () => {
    const dispensingDecisionUpsertMock = vi.fn();
    const packagingGroupFindManyMock = vi.fn().mockResolvedValue([]);
    const dispenseTaskUpdateMock = vi.fn();

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
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              version: 1,
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  source_type: 'manual',
                  original_collected_at: new Date('2026-06-01T00:00:00.000Z'),
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
        packagingGroup: {
          findMany: packagingGroupFindManyMock,
        },
        dispensingDecision: {
          upsert: dispensingDecisionUpsertMock,
        },
        dispenseResult: {
          create: vi.fn(),
          findMany: vi.fn(),
        },
        workflowException: {
          create: vi.fn(),
          updateMany: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            carry_type: 'carry',
            packaging_group_id: 'group_other_cycle',
            packaging_method: 'unit_dose',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '指定された包装グループは現在の調剤サイクルに属していません',
      details: {
        invalid_packaging_groups: [
          {
            line_id: 'line_1',
            packaging_group_id: 'group_other_cycle',
          },
        ],
      },
    });
    expect(packagingGroupFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        id: { in: ['group_other_cycle'] },
      },
      select: { id: true },
    });
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
    expect(dispensingDecisionUpsertMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('updates active visit schedules and downgrades ready schedules when deferred lines remain', async () => {
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
    const visitPreparationUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const membershipFindManyMock = vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
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
              visit_schedules: [
                { id: 'schedule_1', schedule_status: 'ready' },
                { id: 'schedule_2', schedule_status: 'planned' },
              ],
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
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        visitPreparation: { updateMany: visitPreparationUpdateManyMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // B3
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            actual_unit: '錠',
            carry_type: 'carry',
          },
          {
            line_id: 'line_2',
            actual_drug_name: 'ロキソプロフェン',
            actual_drug_code: '456',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            actual_unit: '錠',
            carry_type: 'deferred',
            discrepancy_reason: '欠品後送',
            special_notes: '欠品後送',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_id: { in: ['schedule_1'] },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'schedule_1' },
      data: expect.objectContaining({
        carry_items_status: 'partial',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      }),
    });
    expect(visitScheduleUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'schedule_2' },
      data: expect.objectContaining({
        carry_items_status: 'partial',
      }),
    });
    const plannedUpdateData = visitScheduleUpdateMock.mock.calls[1][0].data;
    expect(plannedUpdateData).not.toHaveProperty('schedule_status');
    expect(plannedUpdateData).not.toHaveProperty('pre_visit_checklist_completed');
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: { overall_status: 'audit_pending', version: { increment: 1 } },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ can_audit_dispense: true }, { role: { in: ['owner', 'admin'] } }],
        }),
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'dispense_audit_pending',
        link: '/audit?taskId=task_1',
        explicitUserIds: ['auditor_1'],
      }),
    );
  });

  it('reopens a ready visit schedule when dispensing regenerates ready carry items', async () => {
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
    const visitPreparationUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const membershipFindManyMock = vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
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
                  ],
                },
              ],
              visit_schedules: [
                { id: 'schedule_1', schedule_status: 'ready' },
                { id: 'schedule_2', schedule_status: 'planned' },
              ],
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
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        visitPreparation: { updateMany: visitPreparationUpdateManyMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン',
            actual_drug_code: '123',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            actual_unit: '錠',
            carry_type: 'carry',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_id: { in: ['schedule_1'] },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'schedule_1' },
      data: expect.objectContaining({
        carry_items_status: 'ready',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      }),
    });
    expect(visitScheduleUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'schedule_2' },
      data: expect.objectContaining({
        carry_items_status: 'ready',
      }),
    });
    const plannedUpdateData = visitScheduleUpdateMock.mock.calls[1][0].data;
    expect(plannedUpdateData).not.toHaveProperty('schedule_status');
    expect(plannedUpdateData).not.toHaveProperty('pre_visit_checklist_completed');
  });

  it('downgrades a ready visit schedule when all carry items are deferred', async () => {
    const dispenseResultCreateMock = vi.fn().mockResolvedValue({
      id: 'result_1',
      line_id: 'line_1',
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
    const visitPreparationUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const membershipFindManyMock = vi.fn().mockResolvedValue([{ user_id: 'auditor_1' }]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'task_1',
            cycle_id: 'cycle_1',
            results: [],
            cycle: {
              id: 'cycle_1',
              patient_id: 'patient_1',
              overall_status: 'dispensing',
              inquiries: [],
              prescription_intakes: [
                {
                  id: 'intake_1',
                  lines: [
                    {
                      id: 'line_1',
                      drug_name: 'ロキソプロフェン',
                      drug_code: '456',
                      quantity: 14,
                    },
                  ],
                },
              ],
              visit_schedules: [{ id: 'schedule_1', schedule_status: 'ready' }],
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
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: { create: cycleTransitionLogCreateMock },
        visitSchedule: { update: visitScheduleUpdateMock },
        visitPreparation: { updateMany: visitPreparationUpdateManyMock },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: 'audit_log_1' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        task_id: 'task_1',
        safety_checklist: safetyChecklist,
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'ロキソプロフェン',
            actual_drug_code: '456',
            actual_quantity: 14,
            ...prescriptionQuantityConfirmed,
            actual_unit: '錠',
            carry_type: 'deferred',
            discrepancy_reason: '欠品後送',
            special_notes: '欠品後送',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_id: { in: ['schedule_1'] },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: expect.objectContaining({
        carry_items_status: 'blocked',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      }),
    });
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
      }),
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
      }),
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
