import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  notificationRuleCountMock,
  notificationRuleFindManyMock,
  notificationRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleCountMock: vi.fn(),
  notificationRuleFindManyMock: vi.fn(),
  notificationRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
    notificationRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    notificationRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
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
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }],
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'notification_rules',
      filters_applied: {},
      limit: 100,
    });
    expect(notificationRuleCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  });

  it('bounds notification rule list size when a limit is provided', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/notification-rules?limit=5'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
      }),
    );
  });

  it('returns counted metadata when the bounded notification rule list is truncated', async () => {
    notificationRuleCountMock.mockResolvedValue(3);
    notificationRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);

    const response = (await GET(
      createGetRequest('http://localhost/api/notification-rules?limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }],
      total_count: 3,
      visible_count: 1,
      hidden_count: 2,
      truncated: true,
      count_basis: 'notification_rules',
      filters_applied: {},
      limit: 1,
    });
  });

  it('clamps overly large notification rule list limits', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/notification-rules?limit=9999'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('creates a notification rule', async () => {
    const response = (await POST(
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
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
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
    });
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = (await POST(createPostRequest([])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

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

    const response = (await GET(createGetRequest()))!;

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

    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
  });
});
