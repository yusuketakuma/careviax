import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  notificationRuleFindManyMock,
  notificationRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
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

function createGetRequest() {
  return new NextRequest('http://localhost/api/notification-rules');
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
    notificationRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    notificationRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          findMany: notificationRuleFindManyMock,
          create: notificationRuleCreateMock,
        },
      }),
    );
  });

  it('lists notification rules', async () => {
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(200);
    expect(notificationRuleFindManyMock).toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleCreateMock).not.toHaveBeenCalled();
  });
});
