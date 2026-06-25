import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withAuthContextMock,
  withOrgContextMock,
  webhookRegistrationFindManyMock,
  webhookRegistrationCreateMock,
  auditLogCreateMock,
  isAllowedWebhookUrlMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'admin' },
        routeContext: { params: Promise<Record<string, never>> },
      ) => Promise<Response>,
      options?: unknown,
    ) => {
      return async (req: NextRequest, routeContext = emptyRouteContext) => {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return authResult.response;
        return handler(req, authResult.ctx, routeContext);
      };
    },
  ),
  withOrgContextMock: vi.fn(),
  webhookRegistrationFindManyMock: vi.fn(),
  webhookRegistrationCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  isAllowedWebhookUrlMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/outbound-webhook', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/services/outbound-webhook')>();
  return {
    ...original,
    isAllowedWebhookUrl: isAllowedWebhookUrlMock,
  };
});

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(method: 'GET' | 'POST', body?: unknown) {
  const init: NextRequestInit = {
    method,
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/admin/webhooks', init);
}

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/admin/webhooks${search}`, {
    method: 'GET',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/webhooks', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/admin/webhooks', () => {
  let originalEncryptionKey: string | undefined;
  let originalWebhookEncryptionKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalWebhookEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'webhook-route-test-encryption-key';
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    requireAuthContextMock.mockResolvedValue({
      ctx: { userId: 'user_1', orgId: 'org_1', role: 'admin' },
    });
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_1',
        url: 'https://partner.example.com/hooks/careviax?token=list-secret#ignored',
        events: ['patient.created'],
        is_active: true,
        created_at: new Date('2026-05-01T00:00:00.000Z'),
        updated_at: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);
    webhookRegistrationCreateMock.mockResolvedValue({
      id: 'webhook_2',
      url: 'https://partner.example.com/hooks/careviax',
      events: ['patient.created'],
      is_active: true,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        webhookRegistration: {
          findMany: webhookRegistrationFindManyMock,
          create: webhookRegistrationCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    isAllowedWebhookUrlMock.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
    if (originalWebhookEncryptionKey === undefined) {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookEncryptionKey;
    }
  });

  it('returns webhook registrations without exposing secrets', async () => {
    const response = await GET(createGetRequest('?limit=5'), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(webhookRegistrationFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
      take: 5,
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'webhook_1',
          url: 'https://partner.example.com/hooks/careviax',
        }),
      ],
    });
    expect(JSON.stringify(body)).not.toContain('list-secret');
  });

  it.each([
    ['', 100],
    ['?limit=200', 200],
    ['?limit=9999', 200],
    ['?limit=0', 1],
    ['?limit=abc', 100],
  ])('bounds webhook registration list size for "%s"', async (search, expectedTake) => {
    const response = await GET(createGetRequest(search), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(webhookRegistrationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1' },
        orderBy: { created_at: 'desc' },
        take: expectedTake,
      }),
    );
  });

  it('does not echo malformed legacy webhook URLs in list responses', async () => {
    webhookRegistrationFindManyMock.mockResolvedValueOnce([
      {
        id: 'webhook_legacy',
        url: 'partner hook token=legacy-secret',
        events: ['patient.created'],
        is_active: true,
        created_at: new Date('2026-05-01T00:00:00.000Z'),
        updated_at: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);

    const response = await GET(createGetRequest(), emptyRouteContext);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: 'webhook_legacy',
      url: '[invalid webhook URL]',
    });
    expect(JSON.stringify(body)).not.toContain('legacy-secret');
  });

  it('creates a webhook registration after URL safety validation', async () => {
    const response = await POST(
      createRequest('POST', {
        url: 'https://partner.example.com/hooks/careviax',
        events: ['patient.created'],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(isAllowedWebhookUrlMock).toHaveBeenCalledWith(
      'https://partner.example.com/hooks/careviax',
    );
    expect(webhookRegistrationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        url: 'https://partner.example.com/hooks/careviax',
        secret: null,
        secret_ciphertext: expect.any(String),
        secret_iv: expect.any(String),
        secret_tag: expect.any(String),
        secret_key_id: 'app:ENCRYPTION_KEY:v1',
        secret_algorithm: 'aes-256-gcm',
        events: ['patient.created'],
      }),
      select: {
        id: true,
        url: true,
        events: true,
        is_active: true,
        created_at: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'webhook_2',
        secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'webhook_registration_created',
        target_type: 'WebhookRegistration',
        target_id: 'webhook_2',
        changes: {
          url: 'https://partner.example.com/hooks/careviax',
          events: ['patient.created'],
          secret_key_id: 'app:ENCRYPTION_KEY:v1',
        },
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('secret_ciphertext');
  });

  it('fails closed when webhook secret encryption is not configured', async () => {
    delete process.env.ENCRYPTION_KEY;

    const response = await POST(
      createRequest('POST', {
        url: 'https://partner.example.com/hooks/careviax',
        events: ['patient.created'],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Webhook secret 暗号化キーが設定されていません',
      code: 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE',
      message: 'Webhook secret 暗号化キーが設定されていません',
    });
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before URL checks or writes', async () => {
    const response = await POST(createRequest('POST', []), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'リクエストボディが不正です',
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before URL checks or writes', async () => {
    const response = await POST(createMalformedJsonRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'リクエストボディが不正です',
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
  });

  it('returns fieldErrors as a compatibility alias for schema validation failures', async () => {
    const response = await POST(
      createRequest('POST', {
        url: 'not-a-url',
        events: [],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: '入力値が不正です',
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        url: expect.any(Array),
        events: expect.any(Array),
      },
      fieldErrors: {
        url: expect.any(Array),
        events: expect.any(Array),
      },
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects webhook URLs with embedded credentials before DNS safety checks', async () => {
    const response = await POST(
      createRequest('POST', {
        url: 'https://user:pass@partner.example.com/hooks/careviax',
        events: ['patient.created'],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'WebhookのURLにユーザー情報は含められません',
      code: 'VALIDATION_ERROR',
      message: 'WebhookのURLにユーザー情報は含められません',
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('redacts query strings from webhook creation audit changes', async () => {
    webhookRegistrationCreateMock.mockResolvedValueOnce({
      id: 'webhook_2',
      url: 'https://partner.example.com/hooks/careviax?token=super-secret#ignored',
      events: ['patient.created'],
      is_active: true,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
    });
    const response = await POST(
      createRequest('POST', {
        url: 'https://partner.example.com/hooks/careviax?token=super-secret#ignored',
        events: ['patient.created'],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: 'webhook_2',
      url: 'https://partner.example.com/hooks/careviax',
      secret: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(body)).not.toContain('super-secret');
    expect(webhookRegistrationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        url: 'https://partner.example.com/hooks/careviax?token=super-secret#ignored',
      }),
      select: expect.any(Object),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          url: 'https://partner.example.com/hooks/careviax',
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('super-secret');
  });
});
