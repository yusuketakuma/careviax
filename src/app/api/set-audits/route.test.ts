import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  taskCreateMock,
  workflowExceptionCreateMock,
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
  taskCreateMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
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

import { POST } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/set-audits',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
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
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1', overall_status: 'setting', version: 1 });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
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
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'set_audited' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        visitSchedule: {
          updateMany: visitScheduleUpdateManyMock,
        },
        task: {
          create: taskCreateMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })
    );
  });

  it('marks visit schedules ready on approved audits', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        cycle_id: 'cycle_1',
      }),
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
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        cycle_id: 'cycle_1',
      }),
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
          }),
        ],
        carry_items_status: 'partial',
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
        { 'x-org-id': 'org_1' }
      )
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
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1', overall_status: 'set_audited', version: 1 });
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        cycle_id: 'cycle_1',
      }),
      data: {
        carry_items: [],
        carry_items_status: 'blocked',
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exception_type: 'set_audit_rejected',
      }),
    });
  });
});
