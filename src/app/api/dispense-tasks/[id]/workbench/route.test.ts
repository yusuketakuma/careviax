import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
  prescriptionIntakeFindFirstMock,
  patientLabObservationFindFirstMock,
  visitScheduleFindFirstMock,
  drugMasterFindManyMock,
  dispenseTaskCountMock,
  pharmacyDrugStockFindFirstMock,
  workflowExceptionCreateMock,
  createAuditLogEntryMock,
  buildMedicationCycleAssignmentWhereMock,
  batchResolveNamesMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authCtx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' as MemberRole },
  withOrgContextMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  patientLabObservationFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  dispenseTaskCountMock: vi.fn(),
  pharmacyDrugStockFindFirstMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  buildMedicationCycleAssignmentWhereMock: vi.fn(),
  batchResolveNamesMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: MemberRole },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { ...authCtx }, routeContext),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      findFirst: dispenseTaskFindFirstMock,
      count: dispenseTaskCountMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    patientLabObservation: {
      findFirst: patientLabObservationFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
    drugMaster: {
      findMany: drugMasterFindManyMock,
    },
    pharmacyDrugStock: {
      findFirst: pharmacyDrugStockFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/utils/name-resolver', () => ({
  batchResolveNames: batchResolveNamesMock,
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildMedicationCycleAssignmentWhere: buildMedicationCycleAssignmentWhereMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, POST } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/workbench');
}

function createInterruptRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/workbench', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/dispense-tasks/[id]/workbench POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCtx.orgId = 'org_1';
    authCtx.userId = 'user_1';
    authCtx.role = 'pharmacist';
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
      cycle: { patient_id: 'patient_1' },
    });
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });
    createAuditLogEntryMock.mockResolvedValue(undefined);
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        workflowException: {
          create: workflowExceptionCreateMock,
        },
      }),
    );
  });

  it('allows clerk read-all and returns count rows with line metadata for medication format grouping', async () => {
    authCtx.role = 'clerk';
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      status: 'pending',
      priority: 'normal',
      due_date: null,
      results: [
        {
          id: 'result_1',
          line_id: 'line_1',
          actual_drug_name: 'アムロジピン 5mg',
          actual_quantity: 28,
          actual_unit: '錠',
          dispensed_by: 'user_2',
          dispensed_at: new Date('2026-06-11T01:00:00.000Z'),
        },
      ],
      cycle: {
        id: 'cycle_1',
        overall_status: 'ready_to_dispense',
        packaging_groups: [
          {
            id: 'group_morning_evening',
            label: '朝夕食後',
            method: '一包化',
            slot: 'morning_evening',
            sort_order: 1,
            version: 3,
          },
        ],
        case_id: 'case_1',
        case_: {
          id: 'case_1',
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            allergy_info: null,
            scheduling_preference: null,
            conditions: [],
          },
        },
        inquiries: [],
        prescription_intakes: [
          {
            id: 'intake_1',
            prescribed_date: new Date('2026-06-10T00:00:00.000Z'),
            prescriber_institution: '青葉クリニック',
            prescriber_name: '佐藤 一郎',
            lines: [
              {
                id: 'line_1',
                line_number: 1,
                drug_name: 'アムロジピン 5mg',
                drug_code: 'yj_1',
                is_generic: true,
                dose: '1回1錠',
                frequency: '朝夕食後',
                start_date: new Date('2026-06-10T00:00:00.000Z'),
                end_date: new Date('2026-06-23T00:00:00.000Z'),
                days: 14,
                quantity: 28,
                unit: '錠',
                route: 'internal',
                dispensing_method: null,
                packaging_method: 'unit_dose',
                packaging_instructions: null,
                packaging_instruction_tags: ['unit_dose'],
                packaging_group_id: 'group_morning_evening',
                updated_at: new Date('2026-06-12T00:00:00.000Z'),
                dispensing_decisions: [
                  {
                    dispensing_method: null,
                    packaging_method: 'unit_dose',
                    packaging_instructions: null,
                    packaging_group_id: 'stale_decision_group',
                  },
                ],
              },
              {
                id: 'line_2',
                line_number: 2,
                drug_name: '酸化マグネシウム 250mg',
                drug_code: 'yj_2',
                is_generic: false,
                dose: '1回1錠',
                frequency: '夕食後',
                start_date: new Date('2026-06-17T00:00:00.000Z'),
                end_date: new Date('2026-06-23T00:00:00.000Z'),
                days: 7,
                quantity: 7,
                unit: '錠',
                route: 'internal',
                dispensing_method: null,
                packaging_method: 'unit_dose',
                packaging_instructions: null,
                packaging_instruction_tags: ['unit_dose'],
                packaging_group_id: 'group_morning_evening',
                updated_at: new Date('2026-06-13T00:00:00.000Z'),
                dispensing_decisions: [],
              },
            ],
          },
        ],
      },
    });
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    visitScheduleFindFirstMock.mockResolvedValue(null);
    drugMasterFindManyMock.mockResolvedValue([]);
    batchResolveNamesMock.mockResolvedValue(new Map([['user_2', '担当 薬剤師']]));
    dispenseTaskCountMock.mockResolvedValue(0);
    pharmacyDrugStockFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), { params: Promise.resolve({ id: 'task_1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      intake: {
        id: 'intake_1',
        prescribed_date: '2026-06-10',
        prescriber_institution: '青葉クリニック',
        prescriber_name: '佐藤 一郎',
      },
      count_rows: [
        {
          line_id: 'line_1',
          line_number: 1,
          dose: '1回1錠',
          days: 14,
          start_date: '2026-06-10',
          end_date: '2026-06-23',
          line_updated_at: '2026-06-12T00:00:00.000Z',
          is_generic: true,
          dispensed_at: '2026-06-11',
          packaging_method: 'unit_dose',
          packaging_group_id: 'group_morning_evening',
        },
        {
          line_id: 'line_2',
          line_number: 2,
          drug_name: '酸化マグネシウム 250mg',
          days: 7,
          start_date: '2026-06-17',
          end_date: '2026-06-23',
          line_updated_at: '2026-06-13T00:00:00.000Z',
          packaging_group_id: 'group_morning_evening',
        },
      ],
      packaging_groups: [
        {
          id: 'group_morning_evening',
          label: '朝夕食後',
          method: '一包化',
          slot: 'morning_evening',
          sort_order: 1,
          version: 3,
        },
      ],
    });
  });

  it.each(['driver', 'external_viewer'] as const)(
    'returns 403 before reading workbench data when %s lacks read permissions',
    async (role) => {
      authCtx.role = role;

      const response = await GET(createGetRequest(), { params: Promise.resolve({ id: 'task_1' }) });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '調剤ワークベンチの閲覧権限がありません',
      });
      expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    },
  );

  it('compares current intake with the previous same-case intake across cycles', async () => {
    const currentPrescribedDate = new Date('2026-06-10T00:00:00.000Z');
    const currentCreatedAt = new Date('2026-06-10T01:00:00.000Z');
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      status: 'pending',
      priority: 'normal',
      due_date: null,
      results: [],
      cycle: {
        id: 'cycle_current',
        overall_status: 'ready_to_dispense',
        version: 1,
        case_id: 'case_1',
        case_: {
          id: 'case_1',
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            allergy_info: null,
            scheduling_preference: null,
            conditions: [],
          },
        },
        inquiries: [],
        prescription_intakes: [
          {
            id: 'intake_current',
            prescribed_date: currentPrescribedDate,
            created_at: currentCreatedAt,
            prescriber_institution: '青葉クリニック',
            prescriber_name: '佐藤 一郎',
            lines: [
              {
                id: 'line_current',
                line_number: 1,
                drug_name: 'アムロジピン 5mg',
                drug_code: 'yj_1',
                is_generic: false,
                dose: '1回0.5錠',
                frequency: '朝食後',
                start_date: null,
                end_date: null,
                days: 14,
                quantity: 7,
                unit: '錠',
                route: 'internal',
                dispensing_method: null,
                packaging_method: null,
                packaging_instructions: null,
                packaging_instruction_tags: [],
                packaging_group_id: null,
                updated_at: new Date('2026-06-10T02:00:00.000Z'),
                dispensing_decisions: [],
              },
            ],
          },
        ],
      },
    });
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_previous_cycle',
      prescribed_date: new Date('2026-05-27T00:00:00.000Z'),
      created_at: new Date('2026-05-27T01:00:00.000Z'),
      lines: [
        {
          id: 'line_previous',
          drug_name: 'アムロジピン 5mg',
          drug_code: 'yj_1',
          dose: '1回1錠',
          frequency: '朝食後',
          days: 14,
          start_date: null,
          end_date: null,
        },
      ],
    });
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    visitScheduleFindFirstMock.mockResolvedValue(null);
    drugMasterFindManyMock.mockResolvedValue([]);
    batchResolveNamesMock.mockResolvedValue(new Map());
    dispenseTaskCountMock.mockResolvedValue(0);
    pharmacyDrugStockFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), { params: Promise.resolve({ id: 'task_1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      previous_intake: { prescribed_date: '2026-05-27' },
      comparison: [
        {
          key: 'line_current',
          drug_name: 'アムロジピン 5mg',
          previous_label: '1回1錠 朝食後',
          current_label: '1回0.5錠 朝食後',
          change_type: 'dose_changed',
        },
      ],
    });
    expect(prescriptionIntakeFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: { not: 'intake_current' },
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
          OR: [
            { prescribed_date: { lt: currentPrescribedDate } },
            {
              prescribed_date: currentPrescribedDate,
              created_at: { lt: currentCreatedAt },
            },
          ],
        }),
      }),
    );
  });

  it('returns 403 when the role lacks dispense permission', async () => {
    authCtx.role = 'clerk';

    const response = await POST(
      createInterruptRequest({ action: 'interrupt', reason: '在庫切れ' }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '調剤の中断権限がありません',
    });
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('records an interrupt audit log entry on success', async () => {
    const response = await POST(
      createInterruptRequest({ action: 'interrupt', reason: '麻薬数量の再確認待ち' }),
      { params: Promise.resolve({ id: 'task_1' }) },
    );

    expect(response.status).toBe(201);
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          exception_type: 'dispense_interrupted',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'dispense_task_interrupted',
        targetType: 'DispenseTask',
        targetId: 'task_1',
        changes: expect.objectContaining({
          reason: '麻薬数量の再確認待ち',
          exception_id: 'exception_1',
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'dispense_tasks_update', task_id: 'task_1', interrupted: true },
    });
  });
});
