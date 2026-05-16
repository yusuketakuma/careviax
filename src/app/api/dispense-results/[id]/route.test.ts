import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  dispenseResultFindFirstMock,
  dispenseAuditFindFirstMock,
  dispenseResultUpdateMock,
  dispenseTaskUpdateMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseResultFindFirstMock: vi.fn(),
  dispenseAuditFindFirstMock: vi.fn(),
  dispenseResultUpdateMock: vi.fn(),
  dispenseTaskUpdateMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    dispenseResult: {
      findFirst: dispenseResultFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const expectedResultAssignmentWhere = {
  task: {
    cycle: {
      case_: {
        OR: [
          { primary_pharmacist_id: 'user_1' },
          { backup_pharmacist_id: 'user_1' },
          { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
        ],
      },
    },
  },
};

describe('/api/dispense-results/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseResultFindFirstMock.mockResolvedValue({
      id: 'result_1',
      org_id: 'org_1',
      task_id: 'task_1',
      line: { id: 'line_1' },
    });
    dispenseAuditFindFirstMock.mockResolvedValue({ id: 'audit_1', result: 'rejected' });
    dispenseResultUpdateMock.mockResolvedValue({ id: 'result_1' });
    dispenseTaskUpdateMock.mockResolvedValue({ cycle_id: 'cycle_1' });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 1,
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseResult: {
          findFirst: dispenseResultFindFirstMock,
          update: dispenseResultUpdateMock,
        },
        dispenseAudit: {
          findFirst: dispenseAuditFindFirstMock,
        },
        dispenseTask: {
          update: dispenseTaskUpdateMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
      }),
    );
  });

  it('returns a dispense result by id', async () => {
    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(dispenseResultFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'result_1',
        org_id: 'org_1',
        ...expectedResultAssignmentWhere,
      },
      include: {
        line: true,
      },
    });
  });

  it('denies unassigned result reads through the cycle assignment scope', async () => {
    dispenseResultFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(404);
  });

  it('patches a dispense result only after a rejected audit and resets statuses', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug B',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(dispenseResultFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'result_1',
        org_id: 'org_1',
        ...expectedResultAssignmentWhere,
      },
      select: {
        id: true,
        task_id: true,
        version: true,
      },
    });
    expect(dispenseResultUpdateMock).toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'completed' },
      select: { cycle_id: true },
    });
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 1 },
      data: { overall_status: 'audit_pending', version: { increment: 1 } },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'dispense_results_rework', result_id: 'result_1' },
    });
  });

  it('denies unassigned result patches before audit checks or writes', async () => {
    dispenseResultFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_unassigned', {
        actual_drug_name: 'Drug B',
      }),
      {
        params: Promise.resolve({ id: 'result_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
