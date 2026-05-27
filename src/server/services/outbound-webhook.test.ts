import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  lookupMock,
  webhookRegistrationFindManyMock,
  fetchMock,
} = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  webhookRegistrationFindManyMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    webhookRegistration: {
      findMany: webhookRegistrationFindManyMock,
    },
  },
}));

import {
  dispatchWebhookEventForOrg,
  isAllowedWebhookUrl,
} from './outbound-webhook';

describe('outbound-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects hostnames that resolve to private IPv4 addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(isAllowedWebhookUrl('https://partner.example.com/webhook')).resolves.toBe(false);
  });

  it('accepts hostnames that resolve only to public IP addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    await expect(isAllowedWebhookUrl('https://partner.example.com/webhook')).resolves.toBe(true);
  });

  it('loads org registrations and dispatches only matching webhook events', async () => {
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_1',
        org_id: 'org_1',
        url: 'https://hooks.example.com/patient',
        secret: 'secret_1',
        events: ['patient.created'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
      {
        id: 'webhook_2',
        org_id: 'org_1',
        url: 'https://hooks.example.com/billing',
        secret: 'secret_2',
        events: ['billing.exported'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
    ]);
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    fetchMock.mockResolvedValue({ status: 202, ok: true });

    const result = await dispatchWebhookEventForOrg('org_1', 'patient.created', {
      patientId: 'patient_1',
    });

    expect(webhookRegistrationFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', is_active: true },
      select: {
        id: true,
        org_id: true,
        url: true,
        secret: true,
        events: true,
        is_active: true,
        created_at: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/patient',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-PH-OS-Event': 'patient.created',
        }),
      })
    );
    expect(result).toMatchObject([
      {
        webhookId: 'webhook_1',
        event: 'patient.created',
        statusCode: 202,
        success: true,
      },
    ]);
  });
});
