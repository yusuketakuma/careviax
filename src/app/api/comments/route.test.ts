import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  taskCommentFindManyMock,
  taskCommentCreateMock,
  membershipFindManyMock,
  userFindManyMock,
  userFindFirstMock,
  medicationCycleFindFirstMock,
  transactionClientMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  canAccessCollaborationEntityMock,
  broadcastOrgRealtimeEventMock,
} = vi.hoisted(() => ({
  taskCommentFindManyMock: vi.fn(),
  taskCommentCreateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  transactionClientMock: {
    taskComment: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    medicationCycle: {
      findFirst: vi.fn(),
    },
  },
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  canAccessCollaborationEntityMock: vi.fn(),
  broadcastOrgRealtimeEventMock: vi.fn(),
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
    membership: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/org-realtime', () => ({
  broadcastOrgRealtimeEvent: broadcastOrgRealtimeEventMock,
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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

type CommentMentionNotificationPayload = {
  orgId: string;
  eventType: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  explicitUserIds: string[];
};

function expectCommentMentionNotification() {
  expect(dispatchNotificationEventMock).toHaveBeenCalledTimes(1);
  const [tx, payload] = dispatchNotificationEventMock.mock.calls[0] ?? [];
  expect(tx).toBe(transactionClientMock);
  return payload as CommentMentionNotificationPayload;
}

function expectPickerAlignedMentionLookup(mentions: string[]) {
  expect(membershipFindManyMock).toHaveBeenCalledWith({
    where: {
      org_id: 'org_1',
      is_active: true,
      role: { in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'] },
      user_id: { in: mentions },
    },
    select: { user_id: true },
  });
  const query = membershipFindManyMock.mock.calls.at(-1)?.[0] as {
    where?: Record<string, unknown>;
  };
  expect(query.where?.user).toBeUndefined();
  expect((query.where?.role as { in?: string[] }).in).not.toContain('clerk');
}

function expectNoCreateNotificationOrRealtimeSideEffects() {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(taskCommentCreateMock).not.toHaveBeenCalled();
  expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
}

describe('/api/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionClientMock.taskComment.create = taskCommentCreateMock;
    transactionClientMock.user.findFirst = userFindFirstMock;
    transactionClientMock.medicationCycle.findFirst = medicationCycleFindFirstMock;
    taskCommentFindManyMock.mockResolvedValue([
      {
        id: 'comment_1',
        author_id: 'user_1',
        content: 'test',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      },
    ]);
    membershipFindManyMock.mockImplementation(
      async (query: { where?: { user_id?: { in?: string[] } } }) =>
        (query.where?.user_id?.in ?? []).map((user_id) => ({ user_id })),
    );
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: 'テスト薬剤師' }]);
    taskCommentCreateMock.mockResolvedValue({ id: 'comment_2', content: 'new comment' });
    userFindFirstMock.mockResolvedValue({ name: 'テスト薬剤師' });
    medicationCycleFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback(transactionClientMock),
    );
    dispatchNotificationEventMock.mockResolvedValue(undefined);
    canAccessCollaborationEntityMock.mockResolvedValue(true);
    broadcastOrgRealtimeEventMock.mockResolvedValue(undefined);
  });

  describe('per-entity authorization', () => {
    it('GET returns 404 when the caller cannot access the entity', async () => {
      canAccessCollaborationEntityMock.mockResolvedValue(false);
      const response = (await GET(
        createGetRequest('entity_type=care_report&entity_id=cr_1'),
        emptyRouteContext,
      ))!;
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(taskCommentFindManyMock).not.toHaveBeenCalled();
    });

    it('POST returns 404 when the caller cannot access the entity', async () => {
      canAccessCollaborationEntityMock.mockResolvedValue(false);
      const response = (await POST(
        createPostRequest({
          entity_type: 'care_report',
          entity_id: 'cr_1',
          content: 'cross-assignment attempt',
          mentions: ['mentioned_1'],
        }),
        emptyRouteContext,
      ))!;
      expect(response.status).toBe(404);
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('returns 200 with comments for entity', async () => {
      const response = (await GET(
        createGetRequest('entity_type=dispense_task&entity_id=dt_1'),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(200);
      expectNoStore(response);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].author_name).toBe('テスト薬剤師');
      expect(taskCommentFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { created_at: 'desc' },
          take: 100,
        }),
      );
    });

    it('returns 400 when entity_type or entity_id is missing', async () => {
      const response = (await GET(createGetRequest(), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
    });

    it('returns a sanitized no-store 500 when comment listing fails unexpectedly', async () => {
      taskCommentFindManyMock.mockRejectedValueOnce(new Error('raw patient comment secret'));

      const response = (await GET(
        createGetRequest('entity_type=dispense_task&entity_id=dt_1'),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(500);
      expectNoStore(response);
      const bodyText = await response.text();
      expect(bodyText).toContain('INTERNAL_ERROR');
      expect(bodyText).not.toContain('raw patient comment secret');
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
      expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        type: 'comment_refresh',
      });
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    });

    it('returns 201 when creating a comment without mentions omitted', async () => {
      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'new comment',
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expect(taskCommentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mentions: [],
        }),
      });
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
      expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        type: 'comment_refresh',
      });
    });

    it('normalizes and dedupes valid mentions before saving and dispatching', async () => {
      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'mention body',
          mentions: [' mentioned_1 ', 'mentioned_1', 'mentioned_2'],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expectPickerAlignedMentionLookup(['mentioned_1', 'mentioned_2']);
      expect(taskCommentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mentions: ['mentioned_1', 'mentioned_2'],
        }),
      });

      const payload = expectCommentMentionNotification();
      expect(payload.explicitUserIds).toEqual(['mentioned_1', 'mentioned_2']);
      expect(payload.link).toBe('/dispense?taskId=dt_1');
      expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        type: 'comment_refresh',
      });
    });

    it('rejects mention recipients outside the picker-aligned membership set before creating a comment', async () => {
      membershipFindManyMock.mockResolvedValue([{ user_id: 'mentioned_1' }]);

      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'mention body',
          mentions: ['mentioned_1', 'missing_1'],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'メンション先が不正です',
      });
      expect(body.details).toBeUndefined();
      expectPickerAlignedMentionLookup(['mentioned_1', 'missing_1']);
      expectNoCreateNotificationOrRealtimeSideEffects();
    });

    it.each([
      ['non-string mention', ['mentioned_1', 123]],
      ['blank mention', ['mentioned_1', '   ']],
      ['too-long mention', ['a'.repeat(101)]],
      [
        'too many mentions',
        Array.from({ length: 21 }, (_value, index) => `mentioned_${index + 1}`),
      ],
    ])('rejects %s before recipient lookup or transaction', async (_caseName, mentions) => {
      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'mention body',
          mentions,
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(400);
      expect(canAccessCollaborationEntityMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expectNoCreateNotificationOrRealtimeSideEffects();
    });

    it('accepts the mention limit boundary', async () => {
      const mentions = Array.from({ length: 20 }, (_value, index) => `mentioned_${index + 1}`);

      const response = (await POST(
        createPostRequest({
          entity_type: 'dispense_task',
          entity_id: 'dt_1',
          content: 'mention body',
          mentions,
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expectPickerAlignedMentionLookup(mentions);
      expect(taskCommentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mentions,
        }),
      });
      const payload = expectCommentMentionNotification();
      expect(payload.explicitUserIds).toEqual(mentions);
    });

    it.each([
      ['patient', (entityId: string) => `/patients/${encodeURIComponent(entityId)}`],
      ['dispense_task', (entityId: string) => `/dispense?taskId=${encodeURIComponent(entityId)}`],
      ['set_plan', (entityId: string) => `/set?planId=${encodeURIComponent(entityId)}`],
      ['visit_record', (entityId: string) => `/visits/${encodeURIComponent(entityId)}`],
      ['care_report', (entityId: string) => `/reports/${encodeURIComponent(entityId)}`],
    ])(
      'encodes %s mention notification links while keeping raw entity identity',
      async (entityType, buildExpectedLink) => {
        const hostileEntityId = '../patients/patient_1?x=1#frag';
        const expectedLink = buildExpectedLink(hostileEntityId);
        const response = (await POST(
          createPostRequest({
            entity_type: entityType,
            entity_id: hostileEntityId,
            content: 'mention body',
            mentions: ['mentioned_1'],
          }),
          emptyRouteContext,
        ))!;

        expect(response.status).toBe(201);
        expect(canAccessCollaborationEntityMock).toHaveBeenCalledWith(
          expect.objectContaining({ orgId: 'org_1' }),
          entityType,
          hostileEntityId,
        );
        expect(taskCommentCreateMock).toHaveBeenCalledWith({
          data: expect.objectContaining({
            entity_type: entityType,
            entity_id: hostileEntityId,
            mentions: ['mentioned_1'],
          }),
        });
        expectPickerAlignedMentionLookup(['mentioned_1']);
        expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();

        const payload = expectCommentMentionNotification();
        expect(payload).toMatchObject({
          orgId: 'org_1',
          eventType: 'comment_mention',
          type: 'business',
          title: 'テスト薬剤師があなたをメンションしました',
          message: 'mention body',
          link: expectedLink,
          explicitUserIds: ['mentioned_1'],
        });
        expect(payload.link).not.toContain(hostileEntityId);
        expect(payload.link).not.toContain('../');
        expect(payload.link).not.toContain('?x=');
        expect(payload.link).not.toContain('#frag');
      },
    );

    it('resolves medication_cycle mention links to the owning patient', async () => {
      const response = (await POST(
        createPostRequest({
          entity_type: 'medication_cycle',
          entity_id: 'cycle_1',
          content: 'cycle mention',
          mentions: ['mentioned_1'],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expect(taskCommentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'medication_cycle',
          entity_id: 'cycle_1',
          mentions: ['mentioned_1'],
        }),
      });
      expectPickerAlignedMentionLookup(['mentioned_1']);
      expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
        where: { id: 'cycle_1', org_id: 'org_1' },
        select: { patient_id: true },
      });

      const payload = expectCommentMentionNotification();
      expect(payload.link).toBe('/patients/patient_1');
      expect(payload.link).not.toBe('/patients/cycle_1');
    });

    it('encodes resolved medication_cycle patient ids as patient path segments', async () => {
      const hostilePatientId = '../settings?x=1#frag';
      medicationCycleFindFirstMock.mockResolvedValue({ patient_id: hostilePatientId });

      const response = (await POST(
        createPostRequest({
          entity_type: 'medication_cycle',
          entity_id: 'cycle_1',
          content: 'cycle mention',
          mentions: ['mentioned_1'],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expectPickerAlignedMentionLookup(['mentioned_1']);
      const payload = expectCommentMentionNotification();
      expect(payload.link).toBe(`/patients/${encodeURIComponent(hostilePatientId)}`);
      expect(payload.link).not.toContain(hostilePatientId);
      expect(payload.link).not.toContain('../');
      expect(payload.link).not.toContain('?x=');
      expect(payload.link).not.toContain('#frag');
    });

    it('uses a null medication_cycle mention link when the cycle cannot be resolved', async () => {
      medicationCycleFindFirstMock.mockResolvedValue(null);

      const response = (await POST(
        createPostRequest({
          entity_type: 'medication_cycle',
          entity_id: 'cycle_1',
          content: 'cycle mention',
          mentions: ['mentioned_1'],
        }),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(201);
      expect(taskCommentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'medication_cycle',
          entity_id: 'cycle_1',
        }),
      });
      expectPickerAlignedMentionLookup(['mentioned_1']);
      const payload = expectCommentMentionNotification();
      expect(payload).toMatchObject({
        link: null,
        explicitUserIds: ['mentioned_1'],
      });
      expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
        orgId: 'org_1',
        type: 'comment_refresh',
      });
    });

    it('rejects malformed JSON before opening an org transaction', async () => {
      const response = (await POST(createInvalidJsonPostRequest(), emptyRouteContext))!;

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
      expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    });

    it('rejects non-object create payloads before opening an org transaction', async () => {
      const response = (await POST(createPostRequest([]), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
      expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    });
  });
});
