'use client';

import Dexie, { type Table } from 'dexie';
import { encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import type { ActionRequest, OfflineOpClass } from '@/phos/contracts/phos_contracts';
import type { PhosOfflineActionQueueResult, PhosOfflineCardActionQueueInput } from './types';

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
