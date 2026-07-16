import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  notificationRuleFindFirstMock,
  notificationRuleUpdateManyMock,
  notificationRuleDeleteManyMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleFindFirstMock: vi.fn(),
  notificationRuleUpdateManyMock: vi.fn(),
  notificationRuleDeleteManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
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

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/utils/logger', () => ({ logger: { error: loggerErrorMock } }));

import { DELETE, GET, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-07-17T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-07-16T00:00:00.000Z';

function ruleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule_1',
    event_type: 'patient_self_report_followup_due',
    channel: 'sms',
    recipients: { roles: ['admin'], user_ids: [] },
    enabled: true,
    created_at: new Date('2026-06-19T10:00:00.000Z'),
    updated_at: new Date(CURRENT_UPDATED_AT),
    ...overrides,
  };
}

function routeContext(id = 'rule_1') {
  return { params: Promise.resolve({ id }) };
}

function createGetRequest() {
  return new NextRequest('http://localhost/api/notification-rules/rule_1');
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notification-rules/rule_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(
  query = `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}`,
) {
  return new NextRequest(`http://localhost/api/notification-rules/rule_1${query}`, {
    method: 'DELETE',
  });
}

describe('/api/notification-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    notificationRuleFindFirstMock.mockResolvedValue(ruleRecord());
    notificationRuleUpdateManyMock.mockResolvedValue({ count: 1 });
    notificationRuleDeleteManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          findFirst: notificationRuleFindFirstMock,
          updateMany: notificationRuleUpdateManyMock,
          deleteMany: notificationRuleDeleteManyMock,
        },
      }),
    );
  });

  it('returns a projected organization-scoped notification rule', async () => {
    const response = await GET(createGetRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'rule_1', org_id: 'org_1' },
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
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
  });

  it('rejects blank route ids before DB access', async () => {
    const response = await GET(createGetRequest(), routeContext('   '));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('updates through an organization-scoped version claim', async () => {
    const response = await PATCH(
      createPatchRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        enabled: false,
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: { throttle_minutes: 30 },
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'rule_1',
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: {
        enabled: false,
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: { throttle_minutes: 30 },
      },
    });
  });

  it.each([
    ['missing version', { enabled: false }],
    ['invalid version', { expected_updated_at: 'yesterday', enabled: false }],
    ['non-object body', []],
    [
      'duplicate recipients',
      { expected_updated_at: CURRENT_UPDATED_AT, recipients: { roles: ['admin', 'admin'] } },
    ],
  ])('rejects %s before DB access', async (_name, body) => {
    const response = await PATCH(createPatchRequest(body), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns a typed conflict without updating a stale rule', async () => {
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: STALE_UPDATED_AT, enabled: false }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(notificationRuleUpdateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      details: {
        conflict_type: 'stale_notification_rule',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
  });

  it('detects a race at the atomic update claim', async () => {
    notificationRuleUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    notificationRuleFindFirstMock
      .mockResolvedValueOnce(ruleRecord())
      .mockResolvedValueOnce({ updated_at: new Date('2026-07-17T01:00:00.000Z') });
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, enabled: false }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { current_updated_at: '2026-07-17T01:00:00.000Z' },
    });
  });

  it('returns neutral 404 without mutating a missing rule', async () => {
    notificationRuleFindFirstMock.mockResolvedValueOnce(null);
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, enabled: false }),
      routeContext('missing'),
    );

    expect(response.status).toBe(404);
    expect(notificationRuleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('deletes through an organization-scoped version claim', async () => {
    const response = await DELETE(createDeleteRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(notificationRuleDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: 'rule_1',
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
    });
    await expect(response.json()).resolves.toEqual({ data: { id: 'rule_1' } });
  });

  it.each([
    ['', 'missing'],
    ['?expected_updated_at=invalid', 'invalid'],
    [
      `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}&expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`,
      'duplicate',
    ],
  ])('rejects %s DELETE version query values before DB access', async (query) => {
    const response = await DELETE(createDeleteRequest(query), routeContext());

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  it('returns a typed conflict without deleting a stale rule', async () => {
    const response = await DELETE(
      createDeleteRequest(`?expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(notificationRuleDeleteManyMock).not.toHaveBeenCalled();
  });

  it('preserves auth rejection bodies with sensitive no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    const response = await GET(createGetRequest(), routeContext());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('sanitizes and traces unexpected update failures', async () => {
    const rawMessage = 'patient:secret medication:secret';
    const error = new Error(rawMessage);
    notificationRuleUpdateManyMock.mockRejectedValueOnce(error);
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, enabled: false }),
      routeContext(),
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(JSON.stringify(await response.json())).not.toContain(rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/notification-rules/rule_1',
        method: 'PATCH',
      }),
      error,
    );
  });
});
