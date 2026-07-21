import { withOrgContext } from '@/lib/db/rls';
import { SmsNotificationAdapter, type TwilioMessageStatusResult } from '@/server/adapters/sms';
import {
  recordTwilioDeliveryReceipt,
  TWILIO_DELIVERY_STATUSES,
  type TwilioDeliveryStatus,
} from '@/server/services/twilio-delivery-receipts';

const DELIVERY_EVENT_TYPE = 'notification.delivery.requested';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const INITIAL_RECONCILIATION_DELAY_MS = 5 * 60 * 1000;
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const TWILIO_DELIVERY_STATUS_SET = new Set<string>(TWILIO_DELIVERY_STATUSES);

type ReconciliationCandidate = {
  id: string;
  idempotencyKey: string;
  messageSid: string;
};

type ReconciliationDependencies = {
  smsAdapter?: Pick<SmsNotificationAdapter, 'fetchTwilioMessageStatus'>;
  now?: () => Date;
};

export type TwilioDeliveryReconciliationResult = {
  scannedCount: number;
  claimedCount: number;
  reconciledCount: number;
  terminalCount: number;
  unavailableCount: number;
  errors: string[];
};

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(value, MAX_BATCH_SIZE);
}

function isTwilioDeliveryStatus(value: string): value is TwilioDeliveryStatus {
  return TWILIO_DELIVERY_STATUS_SET.has(value);
}

function isTerminalStatus(status: TwilioDeliveryStatus) {
  return (
    status === 'delivered' ||
    status === 'read' ||
    status === 'failed' ||
    status === 'undelivered' ||
    status === 'canceled' ||
    status === 'partially_delivered'
  );
}

async function listCandidates(orgId: string, now: Date, batchSize: number) {
  const acceptedBefore = new Date(now.getTime() - INITIAL_RECONCILIATION_DELAY_MS);
  return withOrgContext(orgId, async (tx): Promise<ReconciliationCandidate[]> => {
    const rows = await tx.domainEventOutbox.findMany({
      where: {
        org_id: orgId,
        event_type: DELIVERY_EVENT_TYPE,
        provider: 'twilio',
        status: 'accepted',
        provider_message_id: { not: null },
        accepted_at: { lte: acceptedBefore },
        next_attempt_at: { lte: now },
      },
      orderBy: [{ next_attempt_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true, idempotency_key: true, provider_message_id: true },
    });
    return rows.flatMap((row) =>
      row.provider_message_id
        ? [
            {
              id: row.id,
              idempotencyKey: row.idempotency_key,
              messageSid: row.provider_message_id,
            },
          ]
        : [],
    );
  });
}

async function claimCandidate(orgId: string, candidate: ReconciliationCandidate, now: Date) {
  const nextAttemptAt = new Date(now.getTime() + RECONCILIATION_INTERVAL_MS);
  return withOrgContext(orgId, async (tx) => {
    const claimed = await tx.domainEventOutbox.updateMany({
      where: {
        id: candidate.id,
        org_id: orgId,
        provider: 'twilio',
        provider_message_id: candidate.messageSid,
        status: 'accepted',
        next_attempt_at: { lte: now },
      },
      data: { next_attempt_at: nextAttemptAt },
    });
    return claimed.count === 1;
  });
}

async function persistReconciliationDiagnostic(
  orgId: string,
  candidate: ReconciliationCandidate,
  errorCode: string | null,
) {
  return withOrgContext(orgId, (tx) =>
    tx.domainEventOutbox.updateMany({
      where: {
        id: candidate.id,
        org_id: orgId,
        provider: 'twilio',
        provider_message_id: candidate.messageSid,
        status: 'accepted',
      },
      data: { last_error_code: errorCode },
    }),
  );
}

export async function reconcileTwilioDeliveries(
  orgId: string,
  options: { batchSize?: number } = {},
  dependencies: ReconciliationDependencies = {},
): Promise<TwilioDeliveryReconciliationResult> {
  const now = dependencies.now?.() ?? new Date();
  const batchSize = normalizeBatchSize(options.batchSize);
  const smsAdapter = dependencies.smsAdapter ?? new SmsNotificationAdapter();
  const candidates = await listCandidates(orgId, now, batchSize);
  const summary: TwilioDeliveryReconciliationResult = {
    scannedCount: candidates.length,
    claimedCount: 0,
    reconciledCount: 0,
    terminalCount: 0,
    unavailableCount: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    try {
      if (!(await claimCandidate(orgId, candidate, now))) continue;
      summary.claimedCount += 1;
    } catch {
      summary.errors.push('twilio_status_reconcile_claim_failed');
      continue;
    }

    let result: TwilioMessageStatusResult;
    try {
      result = await smsAdapter.fetchTwilioMessageStatus(candidate.messageSid);
    } catch {
      result = { status: 'unknown' };
    }

    let scheduleErrorCode =
      result.status === 'available' ? null : 'twilio_status_reconcile_unavailable';
    if (result.status === 'available' && isTwilioDeliveryStatus(result.providerStatus)) {
      try {
        await recordTwilioDeliveryReceipt({
          orgId,
          deliveryId: candidate.idempotencyKey,
          messageSid: candidate.messageSid,
          status: result.providerStatus,
          errorCode: result.errorCode,
          receivedAt: now,
        });
        summary.reconciledCount += 1;
        if (isTerminalStatus(result.providerStatus)) summary.terminalCount += 1;
      } catch {
        summary.errors.push('twilio_status_reconcile_projection_failed');
        scheduleErrorCode = 'twilio_status_reconcile_projection_failed';
      }
    } else {
      summary.unavailableCount += 1;
    }

    try {
      await persistReconciliationDiagnostic(orgId, candidate, scheduleErrorCode);
    } catch {
      summary.errors.push('twilio_status_reconcile_diagnostic_failed');
    }
  }

  return summary;
}
