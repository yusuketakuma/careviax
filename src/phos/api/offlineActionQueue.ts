'use client';

import Dexie, { type Table } from 'dexie';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import type { ActionRequest, OfflineOpClass } from '@/phos/contracts/phos_contracts';
import type {
  PhosApiClient,
  PhosOfflineActionQueueResult,
  PhosOfflineCardActionQueueInput,
} from './types';
import { PhosApiError } from './types';

const MAX_RETRIES = 3;
export const PHOS_OFFLINE_ACTION_REPLAY_BATCH_SIZE = 25;

export type PhosOfflineActionRecord = {
  id?: number;
  operation: 'CARD_ACTION';
  card_id: string;
  action_code: ActionRequest['action_code'];
  idempotency_key: string;
  offline_op_class: OfflineOpClass;
  payload: string;
  created_at: string;
  retry_count: number;
  last_error?: string;
  blocked_reason?: 'CONFLICT' | 'MAX_RETRIES';
};

export type PhosOfflineActionStatusView = {
  queue_id: number;
  card_id: string;
  action_code: ActionRequest['action_code'];
  offline_op_class: OfflineOpClass;
  created_at: string;
  retry_count: number;
  last_error?: string;
  blocked_reason?: 'CONFLICT' | 'MAX_RETRIES';
};

export type PhosOfflineSyncMetricEmitter = {
  emitMetric(metric: {
    name: 'OfflineSyncConflictCount';
    value: number;
    unit: 'Count';
    route_key: string;
    action_code: ActionRequest['action_code'];
    error_code: string;
  }): void;
};

class PhosOfflineActionDb extends Dexie {
  offlineActions!: Table<PhosOfflineActionRecord, number>;

  constructor() {
    super('PH-OSActionOfflineQueue');

    this.version(1).stores({
      offlineActions:
        '++id, operation, card_id, action_code, idempotency_key, offline_op_class, created_at, retry_count',
    });
  }
}

export const phosOfflineActionDb = new PhosOfflineActionDb();

export async function enqueuePhosOfflineCardAction(
  input: PhosOfflineCardActionQueueInput,
): Promise<PhosOfflineActionQueueResult> {
  const existing = await phosOfflineActionDb.offlineActions
    .where('idempotency_key')
    .equals(input.request.idempotency_key)
    .first();
  if (existing?.id !== undefined) return { queue_id: existing.id };

  const id = await phosOfflineActionDb.offlineActions.add({
    operation: 'CARD_ACTION',
    card_id: input.card_id,
    action_code: input.request.action_code,
    idempotency_key: input.request.idempotency_key,
    offline_op_class: input.offline_op_class,
    payload: await encryptOfflinePayloadRequired(
      JSON.stringify({ card_id: input.card_id, request: input.request }),
      'PH-OS offline card action payload',
    ),
    created_at: new Date().toISOString(),
    retry_count: 0,
  });

  return { queue_id: id };
}

export async function listPhosPendingOfflineCardActions(): Promise<PhosOfflineActionStatusView[]> {
  const records = await phosOfflineActionDb.offlineActions.orderBy('created_at').toArray();
  return records.map((record) => ({
    queue_id: record.id ?? 0,
    card_id: record.card_id,
    action_code: record.action_code,
    offline_op_class: record.offline_op_class,
    created_at: record.created_at,
    retry_count: record.retry_count,
    ...(record.last_error ? { last_error: record.last_error } : {}),
    ...(record.blocked_reason ? { blocked_reason: record.blocked_reason } : {}),
  }));
}

function errorMessage(error: unknown): string {
  if (error instanceof PhosApiError) return error.response.error_code;
  if (error instanceof Error) return error.message;
  return 'Unknown offline action replay error';
}

function blockedReasonFor(error: unknown, next_retry_count: number) {
  if (error instanceof PhosApiError && error.status === 409) return 'CONFLICT';
  if (next_retry_count >= MAX_RETRIES) return 'MAX_RETRIES';
  return undefined;
}

async function readQueuedCardAction(record: PhosOfflineActionRecord): Promise<{
  card_id: string;
  request: ActionRequest;
}> {
  const payload = await decryptOfflinePayload(record.payload);
  if (!payload) throw new Error('PH-OS offline card action payload could not be decrypted');
  const parsed = JSON.parse(payload) as {
    card_id?: unknown;
    request?: unknown;
  };
  if (typeof parsed.card_id !== 'string' || !parsed.request || typeof parsed.request !== 'object') {
    throw new Error('PH-OS offline card action payload is invalid');
  }
  return {
    card_id: parsed.card_id,
    request: parsed.request as ActionRequest,
  };
}

async function readNextOfflineActionReplayBatch(
  afterId: number,
): Promise<PhosOfflineActionRecord[]> {
  return phosOfflineActionDb.offlineActions
    .where(':id')
    .above(afterId)
    .limit(PHOS_OFFLINE_ACTION_REPLAY_BATCH_SIZE)
    .toArray();
}

export async function retryPhosOfflineCardActions(input: {
  client: Pick<PhosApiClient, 'executeCardAction'>;
  observability?: PhosOfflineSyncMetricEmitter;
}): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  let afterId = 0;

  while (true) {
    const records = await readNextOfflineActionReplayBatch(afterId);
    if (records.length === 0) break;
    afterId = records.reduce((maxId, record) => Math.max(maxId, record.id ?? maxId), afterId);

    for (const record of records) {
      if (record.id === undefined || record.retry_count >= MAX_RETRIES || record.blocked_reason) {
        continue;
      }
      try {
        const payload = await readQueuedCardAction(record);
        await input.client.executeCardAction(payload.card_id, payload.request, {
          offlineReplay: true,
        });
        await phosOfflineActionDb.offlineActions.delete(record.id);
        synced++;
      } catch (error) {
        failed++;
        const next_retry_count = record.retry_count + 1;
        const blocked_reason = blockedReasonFor(error, next_retry_count);
        if (blocked_reason === 'CONFLICT') {
          input.observability?.emitMetric({
            name: 'OfflineSyncConflictCount',
            value: 1,
            unit: 'Count',
            route_key: 'POST /cards/{card_id}/actions',
            action_code: record.action_code,
            error_code: errorMessage(error),
          });
        }
        await phosOfflineActionDb.offlineActions.update(record.id, {
          retry_count: next_retry_count,
          last_error: errorMessage(error),
          blocked_reason,
        });
      }
    }
  }

  return { synced, failed };
}
