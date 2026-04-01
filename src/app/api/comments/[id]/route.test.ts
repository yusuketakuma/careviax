import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  taskCommentFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  taskCommentFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    taskComment: {
      findFirst: taskCommentFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE } from './route';

describe('/api/comments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskCommentFindFirstMock.mockResolvedValue({ id: 'comment_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        taskComment: {
          delete: vi.fn().mockResolvedValue({ id: 'comment_1' }),
        },
      }),
    );
  });

  describe('DELETE', () => {
    it('returns 200 when deleting own comment', async () => {
      const response = (await DELETE(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'comment_1' }) },
      ))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.deleted).toBe(true);
    });

    it('returns 404 when comment not found or not owned', async () => {
      taskCommentFindFirstMock.mockResolvedValue(null);

      const response = (await DELETE(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });
});
