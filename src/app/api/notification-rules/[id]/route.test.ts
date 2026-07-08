import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  notificationRuleFindFirstMock,
  notificationRuleUpdateMock,
  notificationRuleDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationRuleFindFirstMock: vi.fn(),
  notificationRuleUpdateMock: vi.fn(),
  notificationRuleDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(init?: NextRequestInit) {
  return new NextRequest('http://localhost/api/notification-rules/rule_1', init);
}

function createMalformedJsonPatchRequest() {
  return createRequest({
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/notification-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    notificationRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      enabled: true,
    });
    notificationRuleUpdateMock.mockResolvedValue({
      id: 'rule_1',
      enabled: false,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notificationRule: {
          findFirst: notificationRuleFindFirstMock,
          update: notificationRuleUpdateMock,
          delete: notificationRuleDeleteMock,
        },
      }),
    );
  });

  it('returns a notification rule by id', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'rule_1',
        enabled: true,
      },
    });
  });

  it('rejects blank GET route ids before loading the notification rule', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '通知ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleFindFirstMock).not.toHaveBeenCalled();
  });

  it('updates a notification rule', async () => {
    const response = (await PATCH(
      createRequest({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          recipients: { roles: ['admin'], user_ids: ['user_1'] },
          conditions: {
            throttle_minutes: 30,
            fallback: null,
            levels: ['high', null],
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'rule_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'rule_1',
        enabled: false,
      },
    });
    expect(notificationRuleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: expect.objectContaining({
        enabled: false,
        recipients: { roles: ['admin'], user_ids: ['user_1'] },
        conditions: {
          throttle_minutes: 30,
          fallback: null,
          levels: ['high', null],
        },
      }),
    });
  });

  it('rejects non-object update payloads before loading the notification rule', async () => {
    const response = (await PATCH(
      createRequest({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([]),
      }),
      {
        params: Promise.resolve({ id: 'rule_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(notificationRuleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the notification rule', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(notificationRuleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank PATCH route ids before loading the notification rule', async () => {
    const response = (await PATCH(
      createRequest({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '通知ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(notificationRuleUpdateMock).not.toHaveBeenCalled();
  });

  it('deletes a notification rule', async () => {
    const response = (await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'rule_1' },
    });
    expect(notificationRuleDeleteMock).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
    });
  });

  it('rejects blank DELETE route ids before loading the notification rule', async () => {
    const response = (await DELETE(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '通知ルールIDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notificationRuleFindFirstMock).not.toHaveBeenCalled();
    expect(notificationRuleDeleteMock).not.toHaveBeenCalled();
  });

  it('preserves auth rejection bodies while applying sensitive no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_FORBIDDEN',
      message: '権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found responses without changing the detail error body', async () => {
    notificationRuleFindFirstMock.mockResolvedValueOnce(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '通知ルールが見つかりません',
    });
  });

  it('returns a sanitized no-store 500 when detail lookup throws unexpectedly', async () => {
    notificationRuleFindFirstMock.mockRejectedValueOnce(
      new Error('patient:山田太郎 medication:ワルファリン'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'rule_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
  });
});
