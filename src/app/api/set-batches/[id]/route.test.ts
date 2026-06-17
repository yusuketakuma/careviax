import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  setBatchFindFirstMock,
  setBatchUpdateManyMock,
  setBatchDeleteManyMock,
  setBatchChangeLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  setBatchFindFirstMock: vi.fn(),
  setBatchUpdateManyMock: vi.fn(),
  setBatchDeleteManyMock: vi.fn(),
  setBatchChangeLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    setBatch: {
      findFirst: setBatchFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { DELETE, GET, PATCH } from './route';

function createRequest(method: 'DELETE' | 'GET' | 'PATCH' = 'GET', body?: unknown) {
  const url =
    method === 'DELETE'
      ? 'http://localhost/api/set-batches/batch_1?version=2'
      : 'http://localhost/api/set-batches/batch_1';
  return new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/set-batches/batch_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"quantity":',
  });
}

describe('/api/set-batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBatchFindFirstMock.mockResolvedValue({
      id: 'batch_1',
      plan_id: 'plan_1',
      line_id: 'line_1',
      slot: 'morning',
      day_number: 1,
      quantity: 1,
      carry_type: 'carry',
      packaging_method_snapshot: null,
      packaging_instructions_snapshot: null,
      packaging_instruction_tags_snapshot: [],
      version: 2,
      line: { id: 'line_1', drug_name: 'Drug A' },
    });
    setBatchUpdateManyMock.mockResolvedValue({ count: 1 });
    setBatchFindFirstMock
      .mockResolvedValueOnce({
        id: 'batch_1',
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        version: 2,
        line: { id: 'line_1', drug_name: 'Drug A' },
      })
      .mockResolvedValue({
        id: 'batch_1',
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 3,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        version: 3,
        line: { id: 'line_1', drug_name: 'Drug A' },
      });
    setBatchDeleteManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        setBatch: {
          findFirst: setBatchFindFirstMock,
          updateMany: setBatchUpdateManyMock,
          deleteMany: setBatchDeleteManyMock,
        },
        setBatchChangeLog: {
          create: setBatchChangeLogCreateMock,
        },
      }),
    );
  });

  it('returns a set batch with line detail', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('returns 404 for unassigned pharmacist set-batch detail', async () => {
    setBatchFindFirstMock.mockReset();
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(setBatchFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'batch_1',
        org_id: 'org_1',
      },
      include: expect.any(Object),
    });
  });

  it('updates a set batch with optimistic locking', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        quantity: 3,
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'batch_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(setBatchUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'batch_1', org_id: 'org_1', version: 2 },
      data: expect.objectContaining({
        quantity: 3,
        version: { increment: 1 },
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_update', plan_id: 'plan_1', batch_id: 'batch_1' },
    });
  });

  it('rejects non-object patch payloads before transaction side effects', async () => {
    const response = (await PATCH(createRequest('PATCH', []), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setBatchFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = (await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setBatchFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist set-batch updates before side effects', async () => {
    setBatchFindFirstMock.mockReset();
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest('PATCH', {
        quantity: 3,
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'batch_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('deletes a set batch', async () => {
    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(setBatchDeleteManyMock).toHaveBeenCalledWith({
      where: { id: 'batch_1', org_id: 'org_1', version: 2 },
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_delete', plan_id: 'plan_1', batch_id: 'batch_1' },
    });
  });

  it('returns 404 for unassigned pharmacist set-batch deletes before side effects', async () => {
    setBatchFindFirstMock.mockReset();
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(setBatchDeleteManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a version for deletes', async () => {
    const response = (await DELETE(
      new NextRequest('http://localhost/api/set-batches/batch_1', { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: 'batch_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(setBatchDeleteManyMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when delete loses the optimistic lock race', async () => {
    setBatchDeleteManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(409);
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
