import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  workflowExceptionFindFirstMock,
  workflowExceptionUpdateMock,
  workflowExceptionCountMock,
  medicationCycleUpdateMock,
  cycleTransitionLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  workflowExceptionFindFirstMock: vi.fn(),
  workflowExceptionUpdateMock: vi.fn(),
  workflowExceptionCountMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
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

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/workflow-exceptions/exception_1', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/workflow-exceptions/exception_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

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
    cycleTransitionLogCreateMock.mockResolvedValue({});
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
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
      }),
    );
  });

  it('returns a workflow exception by id', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'exception_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('rejects blank route params before exception lookup', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ワークフロー例外IDが不正です',
    });
    expect(workflowExceptionFindFirstMock).not.toHaveBeenCalled();
  });

  it('resolves an open exception and clears the cycle exception status when no open issues remain', async () => {
    const response = (await PATCH(
      createRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'exception_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(workflowExceptionUpdateMock).toHaveBeenCalled();
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { exception_status: null },
    });
  });

  it('rejects blank PATCH route params before body parsing or resolution', async () => {
    const response = (await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ワークフロー例外IDが不正です',
    });
    expect(workflowExceptionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(workflowExceptionUpdateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object PATCH payloads before exception lookup or resolution', async () => {
    const response = (await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'exception_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(workflowExceptionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(workflowExceptionUpdateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PATCH payloads before exception lookup or resolution', async () => {
    const response = (await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'exception_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(workflowExceptionFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(workflowExceptionUpdateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
  });
});
