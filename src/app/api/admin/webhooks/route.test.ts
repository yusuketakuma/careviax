import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  webhookRegistrationFindManyMock,
  webhookRegistrationCreateMock,
  isAllowedWebhookUrlMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  webhookRegistrationFindManyMock: vi.fn(),
  webhookRegistrationCreateMock: vi.fn(),
  isAllowedWebhookUrlMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { userId: 'user_1', orgId: 'org_1', role: 'admin' },
    });
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_1',
        url: 'https://partner.example.com/hooks/careviax',
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
      secret: 'secret_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        webhookRegistration: {
          findMany: webhookRegistrationFindManyMock,
          create: webhookRegistrationCreateMock,
        },
      }),
    );
    isAllowedWebhookUrlMock.mockResolvedValue(true);
  });

  it('returns webhook registrations without exposing secrets', async () => {
    const response = await GET(createRequest('GET'));

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
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'webhook_1' })],
    });
  });

  it('creates a webhook registration after URL safety validation', async () => {
    const response = await POST(
      createRequest('POST', {
        url: 'https://partner.example.com/hooks/careviax',
        events: ['patient.created'],
      }),
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
        events: ['patient.created'],
      }),
      select: {
        id: true,
        url: true,
        events: true,
        is_active: true,
        created_at: true,
        secret: true,
      },
    });
  });

  it('rejects non-object create payloads before URL checks or writes', async () => {
    const response = await POST(createRequest('POST', []));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'リクエストボディが不正です',
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before URL checks or writes', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'リクエストボディが不正です',
    });
    expect(isAllowedWebhookUrlMock).not.toHaveBeenCalled();
    expect(webhookRegistrationCreateMock).not.toHaveBeenCalled();
  });
});
