import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  setBatchFindFirstMock,
  setBatchUpdateMock,
  setBatchDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  setBatchFindFirstMock: vi.fn(),
  setBatchUpdateMock: vi.fn(),
  setBatchDeleteMock: vi.fn(),
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
    setBatch: {
      findFirst: setBatchFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

describe('/api/set-batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBatchFindFirstMock.mockResolvedValue({
      id: 'batch_1',
      version: 2,
      line: { id: 'line_1', drug_name: 'Drug A' },
    });
    setBatchUpdateMock.mockResolvedValue({
      id: 'batch_1',
      version: 3,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        setBatch: {
          findFirst: setBatchFindFirstMock,
          update: setBatchUpdateMock,
          delete: setBatchDeleteMock,
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

  it('updates a set batch with optimistic locking', async () => {
    const response = (await PATCH({
      json: async () => ({
        quantity: 3,
        version: 2,
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(setBatchUpdateMock).toHaveBeenCalledWith({
      where: { id: 'batch_1' },
      data: {
        quantity: 3,
        version: { increment: 1 },
      },
      include: expect.any(Object),
    });
  });

  it('deletes a set batch', async () => {
    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'batch_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(setBatchDeleteMock).toHaveBeenCalledWith({
      where: { id: 'batch_1' },
    });
  });
});
