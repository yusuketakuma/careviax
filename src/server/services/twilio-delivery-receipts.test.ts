import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordTwilioDeliveryReceipt } from './twilio-delivery-receipts';

const { withOrgContextMock } = vi.hoisted(() => ({ withOrgContextMock: vi.fn() }));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));

const DELIVERY_ID = '4fda4c0e-95c0-4a38-8e8f-75822b5e55fb';
const MESSAGE_SID = `SM${'a'.repeat(32)}`;
const NOW = new Date('2026-07-16T05:00:00.000Z');

function createTx(deliveredAt: Date | null = null) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    domainEventOutbox: {
      findFirst: vi.fn().mockResolvedValue({ id: 'outbox_1' }),
      updateMany,
    },
    providerDeliveryReceipt: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'receipt_1',
          provider_message_id: MESSAGE_SID,
          provider_status: 'delivered',
          provider_error_code: null,
          received_at: NOW,
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  tx.domainEventOutbox.findFirst.mockResolvedValue({ id: 'outbox_1', delivered_at: deliveredAt });
  return { tx, updateMany };
}

describe('Twilio delivery receipt projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a reference-only receipt and projects delivered under tenant RLS', async () => {
    const { tx, updateMany } = createTx();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    await expect(
      recordTwilioDeliveryReceipt({
        orgId: 'org_1',
        deliveryId: DELIVERY_ID,
        messageSid: MESSAGE_SID,
        status: 'delivered',
        receivedAt: NOW,
      }),
    ).resolves.toEqual({ appliedCount: 1, pending: false });

    expect(tx.providerDeliveryReceipt.createMany).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'org_1',
          delivery_idempotency_key: DELIVERY_ID,
          provider_message_id: MESSAGE_SID,
          provider_status: 'delivered',
          provider_error_code: null,
          received_at: NOW,
        },
      ],
      skipDuplicates: true,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          provider_message_id: MESSAGE_SID,
          status: { in: ['accepted', 'delivered'] },
        }),
        data: expect.objectContaining({
          status: 'delivered',
          provider_status: 'delivered',
          delivered_at: NOW,
        }),
      }),
    );
  });

  it('keeps a receipt pending when provider acceptance has not committed yet', async () => {
    const { tx } = createTx();
    tx.domainEventOutbox.findFirst.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    await expect(
      recordTwilioDeliveryReceipt({
        orgId: 'org_1',
        deliveryId: DELIVERY_ID,
        messageSid: MESSAGE_SID,
        status: 'sent',
        receivedAt: NOW,
      }),
    ).resolves.toEqual({ appliedCount: 0, pending: true });
    expect(tx.providerDeliveryReceipt.update).not.toHaveBeenCalled();
  });

  it('marks stale out-of-order receipts applied without regressing terminal state', async () => {
    const { tx, updateMany } = createTx();
    updateMany.mockResolvedValue({ count: 0 });
    tx.providerDeliveryReceipt.findMany.mockResolvedValue([
      {
        id: 'receipt_stale',
        provider_message_id: MESSAGE_SID,
        provider_status: 'sent',
        provider_error_code: null,
        received_at: NOW,
      },
    ]);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    await recordTwilioDeliveryReceipt({
      orgId: 'org_1',
      deliveryId: DELIVERY_ID,
      messageSid: MESSAGE_SID,
      status: 'sent',
      receivedAt: NOW,
    });

    expect(tx.providerDeliveryReceipt.update).toHaveBeenCalledWith({
      where: { id: 'receipt_stale' },
      data: { applied_at: NOW },
    });
  });

  it('preserves the original delivery timestamp when a later read receipt arrives', async () => {
    const deliveredAt = new Date('2026-07-16T04:59:00.000Z');
    const { tx, updateMany } = createTx(deliveredAt);
    tx.providerDeliveryReceipt.findMany.mockResolvedValue([
      {
        id: 'receipt_read',
        provider_message_id: MESSAGE_SID,
        provider_status: 'read',
        provider_error_code: null,
        received_at: NOW,
      },
    ]);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (scopedTx: typeof tx) => Promise<unknown>) => work(tx),
    );

    await recordTwilioDeliveryReceipt({
      orgId: 'org_1',
      deliveryId: DELIVERY_ID,
      messageSid: MESSAGE_SID,
      status: 'read',
      receivedAt: NOW,
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider_status: 'read',
          provider_status_at: NOW,
          delivered_at: undefined,
        }),
      }),
    );
  });
});
