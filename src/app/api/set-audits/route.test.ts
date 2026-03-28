import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  setPlanFindFirstMock,
  setBatchFindManyMock,
  setAuditCreateMock,
  medicationCycleUpdateMock,
  visitScheduleUpdateManyMock,
  taskCreateMock,
  workflowExceptionCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  setPlanFindFirstMock: vi.fn(),
  setBatchFindManyMock: vi.fn(),
  setAuditCreateMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
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
    medicationCycleUpdateMock.mockResolvedValue({ id: 'cycle_1' });
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
          create: setAuditCreateMock,
        },
        medicationCycle: {
          update: medicationCycleUpdateMock,
        },
        visitSchedule: {
          updateMany: visitScheduleUpdateManyMock,
        },
        task: {
          create: taskCreateMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
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

  it('blocks visit schedules on rejected audits', async () => {
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
