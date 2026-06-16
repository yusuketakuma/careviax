import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
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

  it('returns count rows with line metadata for medication format grouping', async () => {
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
            lines: [
              {
                id: 'line_1',
                line_number: 1,
                drug_name: 'アムロジピン 5mg',
                drug_code: 'yj_1',
                dose: '1回1錠',
                frequency: '朝夕食後',
                days: 14,
                quantity: 28,
                unit: '錠',
                route: 'internal',
                dispensing_method: null,
                packaging_method: 'unit_dose',
                packaging_instructions: null,
                packaging_instruction_tags: ['unit_dose'],
                packaging_group_id: 'group_morning_evening',
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
      count_rows: [
        {
          line_id: 'line_1',
          line_number: 1,
          dose: '1回1錠',
          days: 14,
          packaging_method: 'unit_dose',
          packaging_group_id: 'group_morning_evening',
        },
      ],
    });
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
