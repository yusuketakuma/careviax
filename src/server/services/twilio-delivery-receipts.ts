import { type Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/rls';

const TWILIO_MESSAGE_SID_RE = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TWILIO_DELIVERY_STATUSES = [
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'undelivered',
  'canceled',
  'partially_delivered',
] as const;

export type TwilioDeliveryStatus = (typeof TWILIO_DELIVERY_STATUSES)[number];

type ReceiptTx = Pick<Prisma.TransactionClient, 'domainEventOutbox' | 'providerDeliveryReceipt'>;

type TwilioDeliveryReceiptInput = {
  orgId: string;
  deliveryId: string;
  messageSid: string;
  status: TwilioDeliveryStatus;
  errorCode?: string | null;
  receivedAt?: Date;
};

const PRIOR_STATUSES: Record<TwilioDeliveryStatus, TwilioDeliveryStatus[]> = {
  accepted: [],
  scheduled: ['accepted'],
  queued: ['accepted', 'scheduled'],
  sending: ['accepted', 'scheduled', 'queued'],
  sent: ['accepted', 'scheduled', 'queued', 'sending'],
  delivered: ['accepted', 'scheduled', 'queued', 'sending', 'sent'],
  read: ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered'],
  failed: ['accepted', 'scheduled', 'queued', 'sending', 'sent'],
  undelivered: ['accepted', 'scheduled', 'queued', 'sending', 'sent'],
  canceled: ['accepted', 'scheduled', 'queued'],
  partially_delivered: ['accepted', 'scheduled', 'queued', 'sending', 'sent'],
};

const FAILED_STATUSES = new Set<TwilioDeliveryStatus>([
  'failed',
  'undelivered',
  'canceled',
  'partially_delivered',
]);

function providerStatusWhere(status: TwilioDeliveryStatus): Prisma.DomainEventOutboxWhereInput {
  return {
    OR: [
      { provider_status: null },
      ...(PRIOR_STATUSES[status].length > 0
        ? [{ provider_status: { in: PRIOR_STATUSES[status] } }]
        : []),
    ],
  };
}

export async function projectPendingTwilioDeliveryReceipts(
  tx: ReceiptTx,
  orgId: string,
  deliveryId: string,
  now: Date,
) {
  const delivery = await tx.domainEventOutbox.findFirst({
    where: {
      org_id: orgId,
      idempotency_key: deliveryId,
      event_type: 'notification.delivery.requested',
      provider: 'twilio',
      status: { in: ['accepted', 'delivered', 'failed'] },
    },
    select: { id: true, delivered_at: true },
  });
  if (!delivery) return { appliedCount: 0, pending: true };

  const receipts = await tx.providerDeliveryReceipt.findMany({
    where: { org_id: orgId, delivery_idempotency_key: deliveryId, applied_at: null },
    orderBy: [{ received_at: 'asc' }, { id: 'asc' }],
  });
  let appliedCount = 0;
  let hasDeliveredAt = delivery.delivered_at != null;

  for (const receipt of receipts) {
    const status = receipt.provider_status as TwilioDeliveryStatus;
    const failed = FAILED_STATUSES.has(status);
    const delivered = status === 'delivered' || status === 'read';
    const statusGuard = delivered
      ? { status: { in: ['accepted', 'delivered'] } }
      : failed
        ? { status: 'accepted' }
        : { status: 'accepted' };
    const updated = await tx.domainEventOutbox.updateMany({
      where: {
        id: delivery.id,
        org_id: orgId,
        provider: 'twilio',
        provider_message_id: receipt.provider_message_id,
        ...statusGuard,
        ...providerStatusWhere(status),
      },
      data: {
        status: delivered ? 'delivered' : failed ? 'failed' : undefined,
        provider_status: status,
        provider_status_at: receipt.received_at,
        delivered_at: delivered && !hasDeliveredAt ? receipt.received_at : undefined,
        failed_at: failed ? receipt.received_at : undefined,
        last_error_code: failed ? `twilio_${receipt.provider_error_code ?? status}` : null,
        completed_at: delivered || failed ? receipt.received_at : undefined,
      },
    });
    if (updated.count === 1 && delivered) hasDeliveredAt = true;
    await tx.providerDeliveryReceipt.update({
      where: { id: receipt.id },
      data: { applied_at: now },
    });
    appliedCount += updated.count;
  }

  return { appliedCount, pending: false };
}

export async function recordTwilioDeliveryReceipt(input: TwilioDeliveryReceiptInput) {
  if (!input.orgId.trim() || !UUID_RE.test(input.deliveryId)) {
    throw new Error('invalid_twilio_delivery_reference');
  }
  if (!TWILIO_MESSAGE_SID_RE.test(input.messageSid)) {
    throw new Error('invalid_twilio_message_sid');
  }
  const receivedAt = input.receivedAt ?? new Date();

  return withOrgContext(input.orgId, async (tx) => {
    await tx.providerDeliveryReceipt.createMany({
      data: [
        {
          org_id: input.orgId,
          delivery_idempotency_key: input.deliveryId,
          provider_message_id: input.messageSid,
          provider_status: input.status,
          provider_error_code: input.errorCode?.trim() || null,
          received_at: receivedAt,
        },
      ],
      skipDuplicates: true,
    });
    return projectPendingTwilioDeliveryReceipts(tx, input.orgId, input.deliveryId, receivedAt);
  });
}
