import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  setPlanFindFirstMock,
  setBatchFindManyMock,
  setAuditFindFirstMock,
  setAuditCreateMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  visitScheduleUpdateManyMock,
  visitPreparationUpdateManyMock,
  taskCreateMock,
  workflowExceptionCreateMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  setPlanFindFirstMock: vi.fn(),
  setBatchFindManyMock: vi.fn(),
  setAuditFindFirstMock: vi.fn(),
  setAuditCreateMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  visitPreparationUpdateManyMock: vi.fn(),
  taskCreateMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/set-audits', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/set-audits', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"plan_id":',
  });
}

describe('/api/set-audits POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    setPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
    });
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ]);
    setAuditCreateMock.mockResolvedValue({ id: 'audit_1' });
    setAuditFindFirstMock.mockResolvedValue(null);
    // Default cycle state: 'setting' (valid source for approved/partial_approved → set_audited)
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'setting',
      version: 1,
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    visitPreparationUpdateManyMock.mockResolvedValue({ count: 1 });
    taskCreateMock.mockResolvedValue({ id: 'task_1' });
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        setPlan: {
          findFirst: setPlanFindFirstMock,
        },
        setBatch: {
          findMany: setBatchFindManyMock,
        },
        setAudit: {
          findFirst: setAuditFindFirstMock,
          create: setAuditCreateMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'set_audited' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        visitSchedule: {
          updateMany: visitScheduleUpdateManyMock,
        },
        visitPreparation: {
          updateMany: visitPreparationUpdateManyMock,
        },
        task: {
          create: taskCreateMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
  });

  it('marks visit schedules ready and downgrades already-ready schedules on approved audits', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
            drug_name: 'アムロジピン錠5mg',
            carry_type: 'carry',
          }),
        ],
        carry_items_status: 'ready',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
            drug_name: 'アムロジピン錠5mg',
            carry_type: 'carry',
          }),
        ],
        carry_items_status: 'ready',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
  });

  it('rejects non-object audit payloads before transaction side effects', async () => {
    const response = await POST(createRequest([], { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditFindFirstMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = await POST(createMalformedPostRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditFindFirstMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist set audits before writes or downstream side effects', async () => {
    setPlanFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(setPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [
          {
            cycle: {
              case_: expect.objectContaining({
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              }),
            },
          },
        ],
      },
      select: {
        id: true,
        cycle_id: true,
        cycle: {
          select: {
            patient_id: true,
          },
        },
      },
    });
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('marks visit schedules partial and creates a rework task on partial approval', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '1-morning': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
          }),
        ],
        carry_items_status: 'partial',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
          }),
        ],
        carry_items_status: 'partial',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'セット再作業（部分承認）',
        related_entity_id: 'cycle_1',
      }),
    });
  });

  it('merges the latest partial approval scope before recalculating carry items', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
      {
        id: 'batch_2',
        slot: 'evening',
        day_number: 2,
        quantity: 2,
        carry_type: 'carry',
        line: {
          id: 'line_2',
          drug_name: 'タケプロンOD錠15mg',
          dose: '1回1錠',
          frequency: '夕食後',
          unit: '錠',
        },
      },
    ]);
    setAuditFindFirstMock.mockResolvedValue({
      result: 'partial_approved',
      approved_scope: {
        '1-morning': true,
      },
    });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '2-evening': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(setAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approved_scope: {
          '1-morning': true,
          '2-evening': true,
        },
      }),
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        cycle_id: 'cycle_1',
      }),
      data: expect.objectContaining({
        carry_items: expect.arrayContaining([
          expect.objectContaining({ batch_id: 'batch_1' }),
          expect.objectContaining({ batch_id: 'batch_2' }),
        ]),
        carry_items_status: 'partial',
      }),
    });
  });

  it('blocks visit schedules on rejected audits', async () => {
    // rejected transitions set_audited → setting
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'set_audited',
      version: 1,
    });
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [],
        carry_items_status: 'blocked',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [],
        carry_items_status: 'blocked',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exception_type: 'set_audit_rejected',
      }),
    });
  });
});
