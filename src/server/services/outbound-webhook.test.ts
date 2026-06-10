import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const {
  lookupMock,
  webhookDeliveryFindManyMock,
  webhookDeliveryUpdateMock,
  webhookDeliveryUpsertMock,
  webhookRegistrationFindManyMock,
  fetchMock,
} = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  webhookDeliveryFindManyMock: vi.fn(),
  webhookDeliveryUpdateMock: vi.fn(),
  webhookDeliveryUpsertMock: vi.fn(),
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
    webhookDelivery: {
      findMany: webhookDeliveryFindManyMock,
      upsert: webhookDeliveryUpsertMock,
      update: webhookDeliveryUpdateMock,
    },
  },
}));

import {
  dispatchWebhookEventForOrg,
  isAllowedWebhookUrl,
  retryDueWebhookDeliveries,
} from './outbound-webhook';
import { encryptWebhookSecret } from './webhook-secret-encryption';

describe('outbound-webhook', () => {
  let originalEncryptionKey: string | undefined;
  let originalWebhookEncryptionKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalWebhookEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    vi.stubGlobal('fetch', fetchMock);
    webhookDeliveryFindManyMock.mockResolvedValue([]);
    webhookDeliveryUpsertMock.mockResolvedValue({});
    webhookDeliveryUpdateMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('rejects hostnames that resolve to private IPv4 addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(isAllowedWebhookUrl('https://partner.example.com/webhook')).resolves.toBe(false);
  });

  it('rejects direct IPv4 hosts that normalize to unsafe local addresses', async () => {
    await expect(isAllowedWebhookUrl('https://127.1/webhook')).resolves.toBe(false);
    await expect(isAllowedWebhookUrl('https://0177.0.0.1/webhook')).resolves.toBe(false);
    await expect(isAllowedWebhookUrl('https://2130706433/webhook')).resolves.toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects reserved and multicast IPv4 destinations', async () => {
    for (const address of ['192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1']) {
      lookupMock.mockResolvedValueOnce([{ address, family: 4 }]);
      await expect(isAllowedWebhookUrl('https://partner.example.com/webhook')).resolves.toBe(false);
    }
  });

  it('rejects IPv4-mapped IPv6 addresses that point to unsafe IPv4 ranges', async () => {
    await expect(isAllowedWebhookUrl('https://[::ffff:127.0.0.1]/webhook')).resolves.toBe(false);
    await expect(isAllowedWebhookUrl('https://[::ffff:7f00:1]/webhook')).resolves.toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects private, documentation, and multicast IPv6 destinations', async () => {
    for (const address of ['fc00::1', 'fe80::1', '2001:db8::1', 'ff02::1']) {
      lookupMock.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(isAllowedWebhookUrl('https://partner.example.com/webhook')).resolves.toBe(false);
    }
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
        secret_ciphertext: true,
        secret_iv: true,
        secret_tag: true,
        secret_key_id: true,
        secret_algorithm: true,
        events: true,
        is_active: true,
        created_at: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(webhookDeliveryUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          org_id: 'org_1',
          webhook_registration_id: 'webhook_1',
          event: 'patient.created',
          url: 'https://hooks.example.com/patient',
          status: 'pending',
        }),
      }),
    );
    expect(webhookDeliveryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'succeeded',
          status_code: 202,
          error: null,
          attempt_count: { increment: 1 },
          next_attempt_at: null,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/patient',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-PH-OS-Event': 'patient.created',
        }),
      }),
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

  it('decrypts encrypted webhook secrets before signing deliveries', async () => {
    process.env.ENCRYPTION_KEY = 'webhook-dispatch-test-encryption-key';
    const encryptedSecret = await encryptWebhookSecret('secret_1');
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_1',
        org_id: 'org_1',
        url: 'https://hooks.example.com/patient',
        secret: null,
        ...encryptedSecret,
        events: ['patient.created'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
    ]);
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    fetchMock.mockResolvedValue({ status: 202, ok: true });

    await dispatchWebhookEventForOrg('org_1', 'patient.created', { patientId: 'patient_1' });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = (init as RequestInit).body;
    expect(typeof body).toBe('string');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/patient',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-PH-OS-Signature': `sha256=${createHmac('sha256', 'secret_1')
            .update(body as string)
            .digest('hex')}`,
        }),
      }),
    );
  });

  it('filters unsupported persisted event values before dispatching', async () => {
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_unsupported_only',
        org_id: 'org_1',
        url: 'https://hooks.example.com/unsupported',
        secret: 'secret_unsupported',
        events: ['patient.deleted', 'admin.created'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
      {
        id: 'webhook_mixed',
        org_id: 'org_1',
        url: 'https://hooks.example.com/patient',
        secret: 'secret_patient',
        events: ['patient.created', 'admin.created'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
    ]);
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    fetchMock.mockResolvedValue({ status: 202, ok: true });

    const result = await dispatchWebhookEventForOrg('org_1', 'patient.created', {
      patientId: 'patient_1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/patient',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-PH-OS-Event': 'patient.created',
        }),
      }),
    );
    expect(result).toMatchObject([
      {
        webhookId: 'webhook_mixed',
        event: 'patient.created',
        statusCode: 202,
        success: true,
      },
    ]);
  });

  it('persists blocked webhook destinations without dispatching HTTP requests', async () => {
    webhookRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'webhook_blocked',
        org_id: 'org_1',
        url: 'https://10.0.0.5/patient',
        secret: 'secret_1',
        events: ['patient.created'],
        is_active: true,
        created_at: new Date('2026-04-05T00:00:00.000Z'),
      },
    ]);

    const result = await dispatchWebhookEventForOrg('org_1', 'patient.created', {
      patientId: 'patient_1',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(webhookDeliveryUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          webhook_registration_id: 'webhook_blocked',
          status: 'pending',
        }),
      }),
    );
    expect(webhookDeliveryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'blocked',
          status_code: null,
          error: 'Blocked unsafe webhook destination',
          attempt_count: { increment: 1 },
          next_attempt_at: null,
        }),
      }),
    );
    expect(result).toMatchObject([
      {
        webhookId: 'webhook_blocked',
        success: false,
        error: 'Blocked unsafe webhook destination',
      },
    ]);
  });

  it('retries due failed webhook deliveries with the original delivery id', async () => {
    webhookDeliveryFindManyMock.mockResolvedValue([
      {
        id: 'delivery_row_1',
        org_id: 'org_1',
        webhook_registration_id: 'webhook_1',
        delivery_id: 'delivery_1',
        event: 'patient.created',
        payload: {
          id: 'delivery_1',
          event: 'patient.created',
          orgId: 'org_1',
          occurredAt: '2026-04-05T00:00:00.000Z',
          data: { patientId: 'patient_1' },
        },
        url: 'https://hooks.example.com/old-patient',
        attempt_count: 1,
        registration: {
          id: 'webhook_1',
          org_id: 'org_1',
          url: 'https://hooks.example.com/patient',
          secret: 'secret_1',
          events: ['patient.created'],
          is_active: true,
          created_at: new Date('2026-04-05T00:00:00.000Z'),
        },
      },
    ]);
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    fetchMock.mockResolvedValue({ status: 204, ok: true });

    const summary = await retryDueWebhookDeliveries({
      orgId: 'org_1',
      now: new Date('2026-04-06T00:00:00.000Z'),
      limit: 10,
      concurrency: 1,
    });

    expect(webhookDeliveryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'failed',
          attempt_count: { lt: 8 },
          next_attempt_at: { lte: new Date('2026-04-06T00:00:00.000Z') },
        }),
        take: 10,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/patient',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-PH-OS-Delivery': 'delivery_1',
          'X-PH-OS-Event': 'patient.created',
        }),
      }),
    );
    expect(webhookDeliveryUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          delivery_id_webhook_registration_id: {
            delivery_id: 'delivery_1',
            webhook_registration_id: 'webhook_1',
          },
        },
        update: expect.objectContaining({
          url: 'https://hooks.example.com/patient',
          status: 'pending',
        }),
      }),
    );
    expect(webhookDeliveryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'succeeded',
          status_code: 204,
          next_attempt_at: null,
        }),
      }),
    );
    expect(summary).toEqual({
      processedCount: 1,
      scannedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      blockedCount: 0,
    });
  });

  it('blocks malformed persisted webhook deliveries instead of retrying forever', async () => {
    webhookDeliveryFindManyMock.mockResolvedValue([
      {
        id: 'delivery_row_bad',
        org_id: 'org_1',
        webhook_registration_id: 'webhook_1',
        delivery_id: 'delivery_1',
        event: 'patient.created',
        payload: {
          id: 'different_delivery',
          event: 'patient.created',
          orgId: 'org_1',
          occurredAt: '2026-04-05T00:00:00.000Z',
          data: { patientId: 'patient_1' },
        },
        url: 'https://hooks.example.com/patient',
        attempt_count: 1,
        registration: {
          id: 'webhook_1',
          org_id: 'org_1',
          url: 'https://hooks.example.com/patient',
          secret: 'secret_1',
          events: ['patient.created'],
          is_active: true,
          created_at: new Date('2026-04-05T00:00:00.000Z'),
        },
      },
    ]);

    const summary = await retryDueWebhookDeliveries({ now: new Date('2026-04-06T00:00:00.000Z') });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(webhookDeliveryUpdateMock).toHaveBeenCalledWith({
      where: { id: 'delivery_row_bad' },
      data: expect.objectContaining({
        status: 'blocked',
        status_code: null,
        error: 'Malformed persisted webhook payload',
        attempt_count: { increment: 1 },
        next_attempt_at: null,
      }),
    });
    expect(summary).toEqual({
      processedCount: 1,
      scannedCount: 1,
      succeededCount: 0,
      failedCount: 0,
      blockedCount: 1,
      errors: ['Malformed persisted webhook payload'],
    });
  });
});
