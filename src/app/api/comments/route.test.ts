import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  taskCommentFindManyMock,
  userFindManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  taskCommentFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    taskComment: {
      findMany: taskCommentFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { GET, POST } from './route';

describe('/api/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskCommentFindManyMock.mockResolvedValue([
      { id: 'comment_1', author_id: 'user_1', content: 'test', entity_type: 'dispense_task', entity_id: 'dt_1' },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: 'テスト薬剤師' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        taskComment: {
          create: vi.fn().mockResolvedValue({ id: 'comment_2', content: 'new comment' }),
        },
        user: {
          findFirst: vi.fn().mockResolvedValue({ name: 'テスト薬剤師' }),
        },
      }),
    );
    dispatchNotificationEventMock.mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('returns 200 with comments for entity', async () => {
      const response = (await GET(
        { url: 'http://localhost/api/comments?entity_type=dispense_task&entity_id=dt_1' } as NextRequest,
        { params: Promise.resolve({}) },
      ))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].author_name).toBe('テスト薬剤師');
    });

    it('returns 400 when entity_type or entity_id is missing', async () => {
      const response = (await GET(
        { url: 'http://localhost/api/comments' } as NextRequest,
        { params: Promise.resolve({}) },
      ))!;

      expect(response.status).toBe(400);
    });
  });

  describe('POST', () => {
    it('returns 201 when creating a comment', async () => {
      const response = (await POST(
        {
          url: 'http://localhost/api/comments',
          json: async () => ({
            entity_type: 'dispense_task',
            entity_id: 'dt_1',
            content: 'new comment',
            mentions: [],
          }),
        } as unknown as NextRequest,
        { params: Promise.resolve({}) },
      ))!;

      expect(response.status).toBe(201);
    });

    it('returns 400 with invalid body', async () => {
      const response = (await POST(
        {
          url: 'http://localhost/api/comments',
          json: async () => { throw new Error('bad json'); },
        } as unknown as NextRequest,
        { params: Promise.resolve({}) },
      ))!;

      expect(response.status).toBe(400);
    });
  });
});
