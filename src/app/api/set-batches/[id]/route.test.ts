import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  setBatchFindFirstMock,
  setBatchUpdateMock,
  setBatchDeleteMock,
  setBatchChangeLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  setBatchFindFirstMock: vi.fn(),
  setBatchUpdateMock: vi.fn(),
  setBatchDeleteMock: vi.fn(),
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
    setBatchUpdateMock.mockResolvedValue({
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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        setBatch: {
          findFirst: setBatchFindFirstMock,
          update: setBatchUpdateMock,
          delete: setBatchDeleteMock,
        },
        setBatchChangeLog: {
          create: setBatchChangeLogCreateMock,
        },
      }),
    );
  });

  it('returns a set batch with line detail', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('returns 404 for unassigned pharmacist set-batch detail', async () => {
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(setBatchFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'batch_1',
        org_id: 'org_1',
        AND: [
          {
            plan: {
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
          },
        ],
      },
      include: expect.any(Object),
    });
  });

  it('updates a set batch with optimistic locking', async () => {
    const response = (await PATCH(
      {
        json: async () => ({
          quantity: 3,
          version: 2,
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'batch_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(setBatchUpdateMock).toHaveBeenCalledWith({
      where: { id: 'batch_1' },
      data: expect.objectContaining({
        quantity: 3,
        version: { increment: 1 },
      }),
      include: expect.any(Object),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_update', plan_id: 'plan_1', batch_id: 'batch_1' },
    });
  });

  it('returns 404 for unassigned pharmacist set-batch updates before side effects', async () => {
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      {
        json: async () => ({
          quantity: 3,
          version: 2,
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'batch_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(setBatchUpdateMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('deletes a set batch', async () => {
    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(setBatchDeleteMock).toHaveBeenCalledWith({
      where: { id: 'batch_1' },
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_delete', plan_id: 'plan_1', batch_id: 'batch_1' },
    });
  });

  it('returns 404 for unassigned pharmacist set-batch deletes before side effects', async () => {
    setBatchFindFirstMock.mockResolvedValue(null);

    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(setBatchDeleteMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
