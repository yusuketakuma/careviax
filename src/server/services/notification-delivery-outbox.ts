import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject } from '@/lib/db/json';
import {
  isProviderDeliveryResult,
  type ProviderDeliveryResult,
} from '@/server/adapters/delivery-result';
import { LineNotificationAdapter } from '@/server/adapters/line';
import { SmsNotificationAdapter } from '@/server/adapters/sms';

const DELIVERY_EVENT_TYPE = 'notification.delivery.requested';
const DELIVERY_AGGREGATE_TYPE = 'user';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const LEASE_MS = 2 * 60 * 1000;
const BASE_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;
const EXTERNAL_NOTIFICATION_TITLE = 'PH-OS通知';
const EXTERNAL_NOTIFICATION_MESSAGE = 'アプリで詳細を確認してください';

export type DurableNotificationChannel = 'sms' | 'line';

type EnqueueTx = {
  domainEventOutbox: Pick<Prisma.TransactionClient['domainEventOutbox'], 'createMany'>;
};

type EnqueueNotificationDeliveriesInput = {
  orgId: string;
  sourceEventType: string;
  dedupeKey?: string | null;
  targets: Array<{ channel: DurableNotificationChannel; userId: string }>;
};

type ClaimedDelivery = {
  id: string;
  orgId: string;
  userId: string;
  channel: DurableNotificationChannel;
  idempotencyKey: string;
  lockToken: string;
  attemptCount: number;
  maxAttempts: number;
  target: string;
};

export type NotificationDeliveryDrainResult = {
  processedCount: number;
  acceptedCount: number;
  retryCount: number;
  unknownCount: number;
  deadLetterCount: number;
  errors: string[];
};

type DeliveryDependencies = {
  smsAdapter?: Pick<SmsNotificationAdapter, 'sendSms'>;
  lineAdapter?: Pick<LineNotificationAdapter, 'sendMessage'>;
  now?: () => Date;
  workerId?: string;
};

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(value, MAX_BATCH_SIZE);
}

function readChannel(metadata: Prisma.JsonValue): DurableNotificationChannel | null {
  const channel = readJsonObject(metadata)?.channel;
  return channel === 'sms' || channel === 'line' ? channel : null;
}

function nextRetryAt(now: Date, attemptCount: number) {
  const multiplier = 2 ** Math.max(0, attemptCount - 1);
  return new Date(now.getTime() + Math.min(BASE_RETRY_MS * multiplier, MAX_RETRY_MS));
}

export async function enqueueNotificationDeliveries(
  tx: EnqueueTx,
  input: EnqueueNotificationDeliveriesInput,
) {
  if (input.targets.length === 0) return 0;

  const dispatchKey = input.dedupeKey?.trim() || randomUUID();
  const uniqueTargets = Array.from(
    new Map(
      input.targets.map((target) => [`${target.channel}:${target.userId}`, target] as const),
    ).values(),
  );
  const result = await tx.domainEventOutbox.createMany({
    data: uniqueTargets.map((target) => ({
      org_id: input.orgId,
      event_type: DELIVERY_EVENT_TYPE,
      aggregate_type: DELIVERY_AGGREGATE_TYPE,
      aggregate_id: target.userId,
      pii_class: 'reference_only',
      metadata: {
        channel: target.channel,
        source_event_type: input.sourceEventType,
      },
      dedupe_key: `${dispatchKey}:${target.channel}:${target.userId}`,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

async function claimDelivery(
  orgId: string,
  id: string,
  now: Date,
  workerId: string,
): Promise<ClaimedDelivery | null> {
  return withOrgContext(orgId, async (tx) => {
    const lockToken = `${workerId}:${randomUUID()}`;
    const eligible = {
      OR: [
        { status: { in: ['pending', 'retry'] }, next_attempt_at: { lte: now } },
        { status: 'processing', locked_until: { lte: now } },
      ],
    } satisfies Prisma.DomainEventOutboxWhereInput;
    const claimed = await tx.domainEventOutbox.updateMany({
      where: { id, org_id: orgId, ...eligible },
      data: {
        status: 'processing',
        lock_token: lockToken,
        locked_until: new Date(now.getTime() + LEASE_MS),
        attempt_count: { increment: 1 },
        last_error_code: null,
      },
    });
    if (claimed.count !== 1) return null;

    const row = await tx.domainEventOutbox.findUnique({ where: { id } });
    if (!row || row.org_id !== orgId || row.aggregate_type !== DELIVERY_AGGREGATE_TYPE) {
      return null;
    }
    const channel = readChannel(row.metadata);
    if (!channel) return null;

    const user = await tx.user.findFirst({
      where: {
        id: row.aggregate_id,
        is_active: true,
        account_status: 'active',
        memberships: { some: { org_id: orgId, is_active: true } },
      },
      select: { id: true, phone: true },
    });
    const target = channel === 'sms' ? user?.phone?.trim() : user?.id;
    if (!target) {
      return {
        id: row.id,
        orgId,
        userId: row.aggregate_id,
        channel,
        idempotencyKey: row.idempotency_key,
        lockToken,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        target: '',
      };
    }
    return {
      id: row.id,
      orgId,
      userId: row.aggregate_id,
      channel,
      idempotencyKey: row.idempotency_key,
      lockToken,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      target,
    };
  });
}

async function persistDeliveryResult(
  delivery: ClaimedDelivery,
  result: ProviderDeliveryResult | null,
  errorCode: string | null,
  now: Date,
) {
  const isAccepted = result?.status === 'accepted';
  const isUnknown = result?.status === 'unknown';
  const exhausted = delivery.attemptCount >= delivery.maxAttempts;
  const status = isAccepted
    ? 'accepted'
    : isUnknown
      ? 'unknown'
      : exhausted
        ? 'dead_letter'
        : 'retry';

  const updated = await withOrgContext(delivery.orgId, (tx) =>
    tx.domainEventOutbox.updateMany({
      where: {
        id: delivery.id,
        org_id: delivery.orgId,
        status: 'processing',
        lock_token: delivery.lockToken,
      },
      data: {
        status,
        lock_token: null,
        locked_until: null,
        provider: result?.provider ?? null,
        provider_message_id: isAccepted ? result.providerMessageId : null,
        last_error_code: isAccepted
          ? null
          : (errorCode ?? `provider_${result?.status ?? 'failed'}`),
        accepted_at: isAccepted ? now : null,
        completed_at: isAccepted || exhausted ? now : null,
        next_attempt_at:
          !isAccepted && !isUnknown && !exhausted ? nextRetryAt(now, delivery.attemptCount) : now,
      },
    }),
  );
  if (updated.count !== 1) throw new Error('notification_delivery_ack_conflict');
  return status;
}

export async function drainNotificationDeliveryOutbox(
  orgId: string,
  options: { batchSize?: number } = {},
  dependencies: DeliveryDependencies = {},
): Promise<NotificationDeliveryDrainResult> {
  const now = dependencies.now?.() ?? new Date();
  const workerId = dependencies.workerId ?? randomUUID();
  const batchSize = normalizeBatchSize(options.batchSize);
  const smsAdapter = dependencies.smsAdapter ?? new SmsNotificationAdapter();
  const lineAdapter = dependencies.lineAdapter ?? new LineNotificationAdapter();
  const candidates = await withOrgContext(orgId, (tx) =>
    tx.domainEventOutbox.findMany({
      where: {
        org_id: orgId,
        event_type: DELIVERY_EVENT_TYPE,
        OR: [
          { status: { in: ['pending', 'retry'] }, next_attempt_at: { lte: now } },
          { status: 'processing', locked_until: { lte: now } },
        ],
      },
      orderBy: [{ next_attempt_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true },
    }),
  );

  const summary: NotificationDeliveryDrainResult = {
    processedCount: 0,
    acceptedCount: 0,
    retryCount: 0,
    unknownCount: 0,
    deadLetterCount: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    const delivery = await claimDelivery(orgId, candidate.id, now, workerId);
    if (!delivery) continue;
    summary.processedCount += 1;

    let result: ProviderDeliveryResult | null = null;
    let errorCode: string | null = null;
    try {
      if (!delivery.target) {
        errorCode = 'delivery_target_unavailable';
      } else if (delivery.channel === 'sms') {
        result = await smsAdapter.sendSms(
          delivery.target,
          `${EXTERNAL_NOTIFICATION_TITLE}\n${EXTERNAL_NOTIFICATION_MESSAGE}`,
        );
      } else {
        result = await lineAdapter.sendMessage(
          delivery.target,
          `${EXTERNAL_NOTIFICATION_TITLE}\n${EXTERNAL_NOTIFICATION_MESSAGE}`,
          { idempotencyKey: delivery.idempotencyKey },
        );
      }
      if (result && !isProviderDeliveryResult(result)) {
        result = null;
        errorCode = 'invalid_provider_result';
      }
    } catch {
      errorCode = 'provider_request_failed';
    }

    try {
      const status = await persistDeliveryResult(delivery, result, errorCode, now);
      if (status === 'accepted') summary.acceptedCount += 1;
      else if (status === 'retry') summary.retryCount += 1;
      else if (status === 'unknown') summary.unknownCount += 1;
      else summary.deadLetterCount += 1;
    } catch {
      summary.errors.push('notification_delivery_ack_persist_failed');
    }
  }

  return summary;
}

export async function listNotificationDeliveryOrgIds(client: Pick<PrismaClient, 'organization'>) {
  const organizations = await client.organization.findMany({
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return organizations.map((organization) => organization.id);
}
