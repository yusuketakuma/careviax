import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withOrgContextMock, recordReceiptMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  recordReceiptMock: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/server/services/twilio-delivery-receipts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/twilio-delivery-receipts')>();
  return { ...actual, recordTwilioDeliveryReceipt: recordReceiptMock };
});

import { reconcileTwilioDeliveries } from './twilio-delivery-reconciliation';

const NOW = new Date('2026-07-21T03:00:00.000Z');
const DELIVERY_ID = '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb';
const MESSAGE_SID = `SM${'a'.repeat(32)}`;

function createTx() {
  return {
    domainEventOutbox: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'outbox_1',
          idempotency_key: DELIVERY_ID,
          provider_message_id: MESSAGE_SID,
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('Twilio delivery status reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordReceiptMock.mockResolvedValue({ appliedCount: 1, pending: false });
  });

  it('fetches bounded stale accepted rows and projects a terminal status', async () => {
    const tx = createTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const fetchTwilioMessageStatus = vi.fn().mockResolvedValue({
      status: 'available',
      providerStatus: 'delivered',
      errorCode: null,
    });

    await expect(
      reconcileTwilioDeliveries(
        'org_1',
        { batchSize: 10 },
        { now: () => NOW, smsAdapter: { fetchTwilioMessageStatus } },
      ),
    ).resolves.toEqual({
      scannedCount: 1,
      claimedCount: 1,
      reconciledCount: 1,
      terminalCount: 1,
      unavailableCount: 0,
      errors: [],
    });

    expect(tx.domainEventOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'accepted',
          provider_message_id: { not: null },
          accepted_at: { lte: new Date('2026-07-21T02:55:00.000Z') },
          next_attempt_at: { lte: NOW },
        }),
        take: 10,
      }),
    );
    expect(fetchTwilioMessageStatus).toHaveBeenCalledWith(MESSAGE_SID);
    expect(recordReceiptMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      deliveryId: DELIVERY_ID,
      messageSid: MESSAGE_SID,
      status: 'delivered',
      errorCode: null,
      receivedAt: NOW,
    });
  });

  it('keeps accepted rows retryable without resending when status lookup is unavailable', async () => {
    const tx = createTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    await expect(
      reconcileTwilioDeliveries(
        'org_1',
        {},
        {
          now: () => NOW,
          smsAdapter: {
            fetchTwilioMessageStatus: vi.fn().mockResolvedValue({ status: 'unknown' }),
          },
        },
      ),
    ).resolves.toMatchObject({ unavailableCount: 1, reconciledCount: 0, errors: [] });

    expect(recordReceiptMock).not.toHaveBeenCalled();
    expect(tx.domainEventOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'outbox_1',
        org_id: 'org_1',
        status: 'accepted',
        provider_message_id: MESSAGE_SID,
      }),
      data: {
        last_error_code: 'twilio_status_reconcile_unavailable',
      },
    });
  });

  it('does not issue a duplicate provider request when another worker wins the due-row claim', async () => {
    const tx = createTx();
    tx.domainEventOutbox.updateMany.mockResolvedValueOnce({ count: 0 });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    const fetchTwilioMessageStatus = vi.fn();

    await expect(
      reconcileTwilioDeliveries(
        'org_1',
        {},
        { now: () => NOW, smsAdapter: { fetchTwilioMessageStatus } },
      ),
    ).resolves.toMatchObject({ scannedCount: 1, claimedCount: 0, reconciledCount: 0 });

    expect(fetchTwilioMessageStatus).not.toHaveBeenCalled();
    expect(recordReceiptMock).not.toHaveBeenCalled();
  });

  it('uses fixed diagnostics and reschedules when receipt projection fails', async () => {
    const tx = createTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );
    recordReceiptMock.mockRejectedValue(new Error('patient name and phone'));

    const result = await reconcileTwilioDeliveries(
      'org_1',
      {},
      {
        now: () => NOW,
        smsAdapter: {
          fetchTwilioMessageStatus: vi.fn().mockResolvedValue({
            status: 'available',
            providerStatus: 'sent',
            errorCode: null,
          }),
        },
      },
    );

    expect(result.errors).toEqual(['twilio_status_reconcile_projection_failed']);
    expect(JSON.stringify(result)).not.toContain('patient name');
    expect(tx.domainEventOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          last_error_code: 'twilio_status_reconcile_projection_failed',
        }),
      }),
    );
  });
});
