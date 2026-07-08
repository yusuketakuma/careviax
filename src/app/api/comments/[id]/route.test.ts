import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { taskCommentFindFirstMock, withOrgContextMock, broadcastOrgRealtimeEventMock } = vi.hoisted(
  () => ({
    taskCommentFindFirstMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    broadcastOrgRealtimeEventMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' },
        routeContext,
      );
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

vi.mock('@/server/services/org-realtime', () => ({
  broadcastOrgRealtimeEvent: broadcastOrgRealtimeEventMock,
}));

import { DELETE } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/comments/comment_1', {
    method: 'DELETE',
  });
}

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
    broadcastOrgRealtimeEventMock.mockResolvedValue(undefined);
  });

  describe('DELETE', () => {
    it('returns 200 when deleting own comment', async () => {
      const response = (await DELETE(createRequest(), {
        params: Promise.resolve({ id: 'comment_1' }),
      }))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ data: { deleted: true } });
      expect(body).not.toHaveProperty('deleted');
      expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        type: 'comment_refresh',
      });
    });

    it('returns 404 when comment not found or not owned', async () => {
      taskCommentFindFirstMock.mockResolvedValue(null);

      const response = (await DELETE(createRequest(), {
        params: Promise.resolve({ id: 'nonexistent' }),
      }))!;

      expect(response.status).toBe(404);
      expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    });
  });
});
