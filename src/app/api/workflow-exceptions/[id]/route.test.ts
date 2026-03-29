import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  workflowExceptionFindFirstMock,
  workflowExceptionUpdateMock,
  workflowExceptionCountMock,
  medicationCycleUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  workflowExceptionFindFirstMock: vi.fn(),
  workflowExceptionUpdateMock: vi.fn(),
  workflowExceptionCountMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    workflowException: {
      findFirst: workflowExceptionFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

describe('/api/workflow-exceptions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowExceptionFindFirstMock.mockResolvedValue({
      id: 'exception_1',
      cycle_id: 'cycle_1',
      status: 'open',
    });
    workflowExceptionUpdateMock.mockResolvedValue({
      id: 'exception_1',
      status: 'resolved',
    });
    workflowExceptionCountMock.mockResolvedValue(0);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        workflowException: {
          update: workflowExceptionUpdateMock,
          count: workflowExceptionCountMock,
          findFirst: workflowExceptionFindFirstMock,
        },
        medicationCycle: {
          update: medicationCycleUpdateMock,
        },
      }),
    );
  });

  it('returns a workflow exception by id', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'exception_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('resolves an open exception and clears the cycle exception status when no open issues remain', async () => {
    const response = (await PATCH({
      json: async () => ({
        status: 'resolved',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'exception_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(workflowExceptionUpdateMock).toHaveBeenCalled();
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { exception_status: null },
    });
  });
});
