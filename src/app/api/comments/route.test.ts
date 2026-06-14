import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  taskCommentFindManyMock,
  userFindManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  canAccessCollaborationEntityMock,
} = vi.hoisted(() => ({
  taskCommentFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  canAccessCollaborationEntityMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
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

// per-entity 認可だけ stub し、entity_type の zod schema は実物を保持する。
vi.mock('@/server/services/collaboration-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/collaboration-access')>()),
  canAccessCollaborationEntity: canAccessCollaborationEntityMock,
}));

import { GET, POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/comments${query ? `?${query}` : ''}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonPostRequest() {
  return new NextRequest('http://localhost/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

describe('/api/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskCommentFindManyMock.mockResolvedValue([
      {
        id: 'comment_1',
        author_id: 'user_1',
        content: 'test',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      },
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
    canAccessCollaborationEntityMock.mockResolvedValue(true);
  });

  describe('per-entity authorization', () => {
    it('GET returns 404 when the caller cannot access the entity', async () => {
      canAccessCollaborationEntityMock.mockResolvedValue(false);
      const response = (await GET(
        createGetRequest('entity_type=care_report&entity_id=cr_1'),
        emptyRouteContext,
      ))!;
      expect(response.status).toBe(404);
      expect(taskCommentFindManyMock).not.toHaveBeenCalled();
    });

    it('POST returns 404 when the caller cannot access the entity', async () => {
      canAccessCollaborationEntityMock.mockResolvedValue(false);
      const response = (await POST(
        createPostRequest({
          entity_type: 'care_report',
          entity_id: 'cr_1',
          content: 'cross-assignment attempt',
          mentions: [],
        }),
        emptyRouteContext,
      ))!;
      expect(response.status).toBe(404);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('returns 200 with comments for entity', async () => {
      const response = (await GET(
        createGetRequest('entity_type=dispense_task&entity_id=dt_1'),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].author_name).toBe('テスト薬剤師');
    });

    it('returns 400 when entity_type or entity_id is missing', async () => {
      const response = (await GET(createGetRequest(), emptyRouteContext))!;

      expect(response.status).toBe(400);
    });
  });

  describe('POST', () => {
    it('returns 201 when creating a comment', async () => {
      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'new comment',
          mentions: [],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
    });

    it('rejects malformed JSON before opening an org transaction', async () => {
      const response = (await POST(createInvalidJsonPostRequest(), emptyRouteContext))!;

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    });

    it('rejects non-object create payloads before opening an org transaction', async () => {
      const response = (await POST(createPostRequest([]), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    });
  });
});
