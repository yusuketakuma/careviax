import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  taskFindFirstMock,
  taskUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

describe('/api/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      completed_at: null,
    });
    taskUpdateMock.mockResolvedValue({
      id: 'task_1',
      status: 'completed',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          update: taskUpdateMock,
        },
      }),
    );
  });

  it('updates a task and sets completed_at when marking it completed', async () => {
    const response = (await PATCH({
      json: async () => ({
        status: 'completed',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(Date),
      }),
    });
  });
});
