import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  notificationRuleCountMock,
  notificationRuleFindManyMock,
  notificationRuleCreateMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleCountMock: vi.fn(),
  notificationRuleFindManyMock: vi.fn(),
  notificationRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
      let response: Response;
      try {
        const authResult = await requireAuthContextMock(req, options);
        response =
          authResult && typeof authResult === 'object' && 'response' in authResult
            ? authResult.response
            : await handler(req, authResult.ctx, routeContext);
      } catch (error) {
        loggerErrorMock(
          {
            event: 'route_handler_unhandled_error',
            route: req.nextUrl.pathname,
            method: req.method,
          },
          error,
        );
        response = new Response(
          JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'サーバー内部でエラーが発生しました',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      return response;
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));
vi.mock('@/lib/utils/logger', () => ({ logger: { error: loggerErrorMock } }));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

const UPDATED_AT = '2026-07-17T00:00:00.000Z';

function ruleRecord(id: string) {
  return {
    id,
    event_type: 'visit_schedule_created',
    channel: 'in_app',
    recipients: { roles: ['admin'], user_ids: ['user_1'] },
    enabled: true,
    created_at: new Date('2026-07-16T00:00:00.000Z'),
    updated_at: new Date(UPDATED_AT),
  };
}

const routeContext = { params: Promise.resolve({}) };

function callGet(request: NextRequest) {
  return GET(request, routeContext);
}

function callPost(request: NextRequest) {
  return POST(request, routeContext);
}

function createGetRequest(url = 'http://localhost/api/notification-rules') {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notification-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/notification-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/notification-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    notificationRuleCountMock.mockResolvedValue(1);
    notificationRuleFindManyMock.mockResolvedValue([ruleRecord('rule_1')]);
    notificationRuleCreateMock.mockResolvedValue(ruleRecord('rule_2'));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          count: notificationRuleCountMock,
          findMany: notificationRuleFindManyMock,
          create: notificationRuleCreateMock,
        },
      }),
    );
  });

  it('lists notification rules', async () => {
    const response = await callGet(createGetRequest());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'meta']);
    expect(body).toMatchObject({
      data: [{ id: 'rule_1' }],
      meta: {
        generated_at: expect.any(String),
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'notification_rules',
        filters_applied: {},
        limit: 100,
      },
    });
    expect(new Date(body.meta.generated_at).toISOString()).toBe(body.meta.generated_at);
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(notificationRuleCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      select: {
        id: true,
        event_type: true,
        channel: true,
        recipients: true,
        enabled: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
  });

  it('bounds notification rule list size when a limit is provided', async () => {
    const response = await callGet(
      createGetRequest('http://localhost/api/notification-rules?limit=5'),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
      }),
    );
  });

  it('rejects duplicate limits before opening an org transaction', async () => {
    const response = await callGet(
      createGetRequest('http://localhost/api/notification-rules?limit=5&limit=10'),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns counted metadata when the bounded notification rule list is truncated', async () => {
    notificationRuleCountMock.mockResolvedValue(3);
    notificationRuleFindManyMock.mockResolvedValue([ruleRecord('rule_1')]);

    const response = await callGet(
      createGetRequest('http://localhost/api/notification-rules?limit=1'),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }],
      meta: {
        generated_at: expect.any(String),
        total_count: 3,
        visible_count: 1,
        hidden_count: 2,
        truncated: true,
        count_basis: 'notification_rules',
        filters_applied: {},
        limit: 1,
      },
    });
  });

  it('clamps overly large notification rule list limits', async () => {
    const response = await callGet(
      createGetRequest('http://localhost/api/notification-rules?limit=9999'),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('creates a notification rule', async () => {
    const response = await callPost(
      createPostRequest({
        event_type: 'visit_schedule_created',
        channel: 'in_app',
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: {
          min_priority: 'urgent',
          skipped: undefined,
          fallback: null,
          levels: ['high', undefined],
        },
      }),
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'rule_2' } });
    expect(notificationRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        event_type: 'visit_schedule_created',
        channel: 'in_app',
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: {
          min_priority: 'urgent',
          fallback: null,
          levels: ['high', null],
        },
      }),
      select: {
        id: true,
        event_type: true,
        channel: true,
        recipients: true,
        enabled: true,
        created_at: true,
        updated_at: true,
      },
    });
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = await callPost(createPostRequest([]));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate recipients before opening an org transaction', async () => {
    const response = await callPost(
      createPostRequest({
        event_type: 'visit_schedule_created',
        channel: 'in_app',
        recipients: { roles: ['admin', 'admin'] },
      }),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = await callPost(createMalformedJsonPostRequest());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });

  it('preserves auth rejection bodies while applying sensitive no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = await callGet(createGetRequest());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_FORBIDDEN',
      message: '権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when notification rule listing throws unexpectedly', async () => {
    notificationRuleCountMock.mockRejectedValueOnce(
      new Error('patient:山田太郎 medication:ワルファリン'),
    );

    const response = await callGet(createGetRequest());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/notification-rules',
        method: 'GET',
      }),
      expect.any(Error),
    );
  });
});
