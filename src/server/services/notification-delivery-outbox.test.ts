import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drainNotificationDeliveryOutbox,
  enqueueNotificationDeliveries,
} from './notification-delivery-outbox';

const { withOrgContextMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

const NOW = new Date('2026-07-16T04:00:00.000Z');
const RETRY_KEY = '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb';

function createWorkerTx(overrides: { attemptCount?: number; maxAttempts?: number } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    domainEventOutbox: {
      findMany: vi.fn().mockResolvedValue([{ id: 'outbox_1' }]),
      updateMany,
      findUnique: vi.fn().mockResolvedValue({
        id: 'outbox_1',
        org_id: 'org_1',
        event_type: 'notification.delivery.requested',
        aggregate_type: 'user',
        aggregate_id: 'user_1',
        metadata: { channel: 'line', source_event_type: 'visit_due' },
        idempotency_key: RETRY_KEY,
        attempt_count: overrides.attemptCount ?? 1,
        max_attempts: overrides.maxAttempts ?? 5,
      }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'user_1', phone: '09000000001' }),
    },
  };
  return { tx, updateMany };
}

describe('notification delivery outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
            { channel: 'sms', userId: 'user_1' },
            { channel: 'sms', userId: 'user_1' },
            { channel: 'line', userId: 'user_1' },
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
});
