import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drainNotificationDeliveryOutbox,
  enqueueNotificationDeliveries,
} from './notification-delivery-outbox';

const { withOrgContextMock, sendWebPushMock, setVapidDetailsMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  sendWebPushMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('web-push', () => ({
  default: {
    sendNotification: sendWebPushMock,
    setVapidDetails: setVapidDetailsMock,
  },
}));

const NOW = new Date('2026-07-16T04:00:00.000Z');
const RETRY_KEY = '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb';

function createWorkerTx(
  overrides: {
    attemptCount?: number;
    maxAttempts?: number;
    channel?: 'sms' | 'line' | 'web_push';
  } = {},
) {
  const channel = overrides.channel ?? 'line';
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const pushSubscriptionFindFirst = vi.fn().mockResolvedValue({
    endpoint: 'https://push.example.test/subscription',
    p256dh: 'p256dh-key',
    auth: 'auth-secret',
  });
  const pushSubscriptionDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    domainEventOutbox: {
      findMany: vi.fn().mockResolvedValue([{ id: 'outbox_1' }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'outbox_1' }),
      updateMany,
      findUnique: vi.fn().mockResolvedValue({
        id: 'outbox_1',
        org_id: 'org_1',
        event_type: 'notification.delivery.requested',
        aggregate_type: channel === 'web_push' ? 'push_subscription' : 'user',
        aggregate_id: channel === 'web_push' ? 'push_subscription_1' : 'user_1',
        metadata: {
          channel,
          source_event_type: 'visit_due',
          ...(channel === 'web_push' ? { notification_type: 'urgent' } : {}),
        },
        idempotency_key: RETRY_KEY,
        attempt_count: overrides.attemptCount ?? 1,
        max_attempts: overrides.maxAttempts ?? 5,
      }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'user_1', phone: '09000000001' }),
    },
    pushSubscription: {
      findFirst: pushSubscriptionFindFirst,
      deleteMany: pushSubscriptionDeleteMany,
    },
    providerDeliveryReceipt: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return { tx, updateMany, pushSubscriptionFindFirst, pushSubscriptionDeleteMany };
}

describe('notification delivery outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWebPushMock.mockReset();
    setVapidDetailsMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('persists only tenant-bound aggregate references and channel metadata', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });

    await expect(
      enqueueNotificationDeliveries(
        { domainEventOutbox: { createMany } },
        {
          orgId: 'org_1',
          sourceEventType: 'patient_followup_due',
          dedupeKey: 'followup_1',
          targets: [
            { channel: 'sms', aggregateType: 'user', aggregateId: 'user_1' },
            { channel: 'sms', aggregateType: 'user', aggregateId: 'user_1' },
            { channel: 'line', aggregateType: 'user', aggregateId: 'user_1' },
          ],
        },
      ),
    ).resolves.toBe(2);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          aggregate_type: 'user',
          aggregate_id: 'user_1',
          pii_class: 'reference_only',
          metadata: { channel: 'sms', source_event_type: 'patient_followup_due' },
          dedupe_key: 'followup_1:sms:user_1',
        }),
        expect.objectContaining({
          metadata: { channel: 'line', source_event_type: 'patient_followup_due' },
          dedupe_key: 'followup_1:line:user_1',
        }),
      ],
      skipDuplicates: true,
    });
    expect(JSON.stringify(createMany.mock.calls)).not.toContain('09000000001');
  });

  it('claims with a lease, resolves the target under RLS, and persists provider acceptance', async () => {
    const { tx, updateMany } = createWorkerTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendMessage = vi.fn().mockResolvedValue({
      status: 'accepted',
      provider: 'line',
      providerMessageId: 'line-request-1',
    });

    await expect(
      drainNotificationDeliveryOutbox(
        'org_1',
        { batchSize: 10 },
        {
          now: () => NOW,
          workerId: 'worker_1',
          lineAdapter: { sendMessage },
        },
      ),
    ).resolves.toEqual({
      processedCount: 1,
      acceptedCount: 1,
      retryCount: 0,
      unknownCount: 0,
      deadLetterCount: 0,
      errors: [],
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'user_1',
      'PH-OS通知\nアプリで詳細を確認してください',
      {
        idempotencyKey: RETRY_KEY,
      },
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox_1', org_id: 'org_1' }),
        data: expect.objectContaining({
          status: 'processing',
          attempt_count: { increment: 1 },
          locked_until: new Date('2026-07-16T04:02:00.000Z'),
        }),
      }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'outbox_1',
          status: 'processing',
          lock_token: expect.stringContaining('worker_1:'),
        }),
        data: expect.objectContaining({
          status: 'accepted',
          provider: 'line',
          provider_message_id: 'line-request-1',
          accepted_at: NOW,
        }),
      }),
    );
  });

  it('does not resend an unknown provider outcome and records it for reconciliation', async () => {
    const { tx, updateMany } = createWorkerTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendMessage = vi.fn().mockResolvedValue({
      status: 'unknown',
      provider: 'line',
      providerMessageId: null,
    });

    const result = await drainNotificationDeliveryOutbox(
      'org_1',
      {},
      {
        now: () => NOW,
        lineAdapter: { sendMessage },
      },
    );

    expect(result.unknownCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'unknown',
          completed_at: null,
          last_error_code: 'provider_unknown',
        }),
      }),
    );
  });

  it('projects a callback that raced provider acceptance after the Twilio ack commits', async () => {
    const { tx, updateMany } = createWorkerTx({ channel: 'sms' });
    tx.providerDeliveryReceipt.findMany.mockResolvedValue([
      {
        id: 'receipt_1',
        provider_message_id: `SM${'a'.repeat(32)}`,
        provider_status: 'delivered',
        provider_error_code: null,
        received_at: NOW,
      },
    ]);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendSms = vi.fn().mockResolvedValue({
      status: 'accepted',
      provider: 'twilio',
      providerMessageId: `SM${'a'.repeat(32)}`,
    });

    const result = await drainNotificationDeliveryOutbox(
      'org_1',
      {},
      { now: () => NOW, smsAdapter: { sendSms } },
    );

    expect(result.acceptedCount).toBe(1);
    expect(sendSms).toHaveBeenCalledWith(
      '09000000001',
      'PH-OS通知\nアプリで詳細を確認してください',
      { callbackContext: { orgId: 'org_1', deliveryId: RETRY_KEY } },
    );
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'delivered', provider_status: 'delivered' }),
      }),
    );
  });

  it('moves a bounded final failure to dead letter', async () => {
    const { tx, updateMany } = createWorkerTx({ attemptCount: 5, maxAttempts: 5 });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendMessage = vi.fn().mockResolvedValue({
      status: 'failed',
      provider: 'line',
      providerMessageId: null,
    });

    const result = await drainNotificationDeliveryOutbox(
      'org_1',
      {},
      {
        now: () => NOW,
        lineAdapter: { sendMessage },
      },
    );

    expect(result.deadLetterCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'dead_letter', completed_at: NOW }),
      }),
    );
  });

  it('backs off a retryable provider rejection before the attempt limit', async () => {
    const { tx, updateMany } = createWorkerTx({ attemptCount: 2, maxAttempts: 5 });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendMessage = vi.fn().mockResolvedValue({
      status: 'failed',
      provider: 'line',
      providerMessageId: null,
    });

    const result = await drainNotificationDeliveryOutbox(
      'org_1',
      {},
      { now: () => NOW, lineAdapter: { sendMessage } },
    );

    expect(result.retryCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'retry',
          completed_at: null,
          next_attempt_at: new Date('2026-07-16T04:02:00.000Z'),
        }),
      }),
    );
  });

  it('skips a candidate when another worker wins the compare-and-set claim', async () => {
    const { tx, updateMany } = createWorkerTx();
    updateMany.mockResolvedValueOnce({ count: 0 });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const sendMessage = vi.fn();

    const result = await drainNotificationDeliveryOutbox(
      'org_1',
      {},
      {
        now: () => NOW,
        lineAdapter: { sendMessage },
      },
    );

    expect(result.processedCount).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('resolves a Web Push subscription under RLS and sends only the redacted payload', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
    const { tx, updateMany, pushSubscriptionFindFirst } = createWorkerTx({
      channel: 'web_push',
    });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    sendWebPushMock.mockResolvedValue({ statusCode: 201 });

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.acceptedCount).toBe(1);
    expect(pushSubscriptionFindFirst).toHaveBeenCalledWith({
      where: { id: 'push_subscription_1', org_id: 'org_1' },
      select: { endpoint: true, p256dh: true, auth: true },
    });
    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'public-key',
      'private-key',
    );
    expect(sendWebPushMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendWebPushMock.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      type: 'urgent',
      title: 'PH-OS 通知',
      body: '新しい緊急通知があります',
      link: '/notifications',
    });
    expect(JSON.stringify(payload)).not.toContain('/patients/');
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'accepted',
          provider: 'web_push',
          provider_message_id: null,
        }),
      }),
    );
  });

  it('keeps an unconfigured Web Push intent retryable without calling the provider', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    const { tx, updateMany } = createWorkerTx({ channel: 'web_push' });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.retryCount).toBe(1);
    expect(sendWebPushMock).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'retry',
          provider: 'web_push',
          last_error_code: 'provider_not_configured',
        }),
      }),
    );
  });

  it('keeps invalid VAPID configuration retryable without reporting an unknown send outcome', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'invalid-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'invalid-private-key');
    setVapidDetailsMock.mockImplementation(() => {
      throw new Error('invalid VAPID configuration');
    });
    const { tx, updateMany } = createWorkerTx({ channel: 'web_push' });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.retryCount).toBe(1);
    expect(result.unknownCount).toBe(0);
    expect(sendWebPushMock).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'retry',
          last_error_code: 'push_vapid_configuration_invalid',
        }),
      }),
    );
  });

  it('does not report Web Push accepted without the RFC 8030 201 response', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
    const { tx, updateMany } = createWorkerTx({ channel: 'web_push' });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    sendWebPushMock.mockResolvedValue({ statusCode: 202 });

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.retryCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'retry',
          last_error_code: 'push_service_unexpected_response',
        }),
      }),
    );
  });

  it('records a Web Push network outcome as unknown without automatic resend', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
    const { tx, updateMany } = createWorkerTx({ channel: 'web_push' });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    sendWebPushMock.mockRejectedValue(new Error('response lost'));

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.unknownCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'unknown',
          completed_at: null,
          last_error_code: 'push_service_outcome_unknown',
        }),
      }),
    );
  });

  it('deletes an expired Web Push subscription and dead-letters the intent', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
    const { tx, updateMany, pushSubscriptionDeleteMany } = createWorkerTx({
      channel: 'web_push',
    });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    sendWebPushMock.mockRejectedValue(
      Object.assign(new Error('expired endpoint'), { statusCode: 410 }),
    );

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.deadLetterCount).toBe(1);
    expect(pushSubscriptionDeleteMany).toHaveBeenCalledWith({
      where: { id: 'push_subscription_1', org_id: 'org_1' },
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'dead_letter',
          last_error_code: 'push_subscription_expired',
        }),
      }),
    );
  });

  it('retries instead of dead-lettering when expired-subscription cleanup is not durable', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
    const { tx, updateMany, pushSubscriptionDeleteMany } = createWorkerTx({
      channel: 'web_push',
    });
    pushSubscriptionDeleteMany.mockRejectedValue(new Error('database unavailable'));
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    sendWebPushMock.mockRejectedValue(
      Object.assign(new Error('expired endpoint'), { statusCode: 410 }),
    );

    const result = await drainNotificationDeliveryOutbox('org_1', {}, { now: () => NOW });

    expect(result.retryCount).toBe(1);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'retry',
          last_error_code: 'push_subscription_cleanup_failed',
        }),
      }),
    );
  });
});
