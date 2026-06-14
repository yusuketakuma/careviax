import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonPatchRequest(id = 'result_1') {
  return new NextRequest(`http://localhost/api/dispense-results/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"actual_drug_name":',
  });
}

// 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
// org-only の WHERE になる。担当割当の OR 句は付与されない。
const expectedResultAssignmentWhere = {};

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

  it('rejects blank route params before result lookup', async () => {
    const response = (await GET(createRequest('http://localhost/api/dispense-results/%20%20'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実績IDが不正です',
    });
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects blank patch route params before body parsing or rework side effects', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(''), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実績IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before result lookup or rework side effects', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', []),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before result lookup or rework side effects', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
