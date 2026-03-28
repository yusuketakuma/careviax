'use client';

import { decryptOfflinePayload, encryptOfflinePayload } from '@/lib/offline/crypto';
import { offlineDb, type OfflineSyncQueue } from './offline-db';

const MAX_RETRIES = 3;

type SyncConfig = {
  orgId: string;
  endpoints: Record<string, string>;
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  visit_record: '/api/visit-records',
  residual_medication: '/api/residual-medications',
};

type VisitRecordConflictSnapshot = {
  local: Record<string, unknown>;
  server: {
    id: string;
    version: number;
    patient_id: string;
    visit_date: string;
    outcome_status: string;
    soap_subjective?: string | null;
    soap_objective?: string | null;
    soap_assessment?: string | null;
    soap_plan?: string | null;
    next_visit_suggestion_date?: string | null;
    residual_medications?: Array<{
      drug_name: string;
      drug_code?: string | null;
      prescribed_quantity?: number | null;
      prescribed_daily_dose?: number | null;
      remaining_quantity: number;
      is_prohibited_reduction: boolean;
    }>;
  } | null;
};

export type SyncQueueItemSummary = Omit<OfflineSyncQueue, 'payload' | 'conflict_payload'> & {
  payload: Record<string, unknown>;
  conflict: VisitRecordConflictSnapshot | null;
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Process all pending items in the sync queue.
 * Called when the browser comes back online.
 */
export async function processSyncQueue(config: SyncConfig): Promise<{
  synced: number;
  failed: number;
}> {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };
  const pending = await offlineDb.syncQueue
    .where('retryCount')
    .below(MAX_RETRIES)
    .toArray();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const endpoint = endpoints[item.entityType];
      if (!endpoint) {
        failed++;
        continue;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': config.orgId,
        },
        body: (await decryptOfflinePayload(item.payload)) ?? item.payload,
      });

      if (res.ok) {
        await offlineDb.syncQueue.delete(item.id!);
        if (item.entityType === 'visit_record' && item.scope_id) {
          await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
        }
        synced++;
      } else if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as
          | {
              details?: {
                existing_record?: VisitRecordConflictSnapshot['server'];
              };
            }
          | null;
        const parsedPayload =
          parseJson<Record<string, unknown>>(
            await decryptOfflinePayload(item.payload)
          ) ?? {};
        // Keep the draft in queue so the user can resolve the conflict later.
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: MAX_RETRIES,
          lastError: 'HTTP 409 conflict',
          conflict_state: 'server_conflict',
          conflict_payload: await encryptOfflinePayload(
            JSON.stringify({
              local: parsedPayload,
              server: body?.details?.existing_record ?? null,
            } satisfies VisitRecordConflictSnapshot)
          ),
        });
        failed++;
      } else {
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${res.status}`,
          conflict_state: undefined,
          conflict_payload: undefined,
        });
        failed++;
      }
    } catch (err) {
      await offlineDb.syncQueue.update(item.id!, {
        retryCount: item.retryCount + 1,
        lastError: err instanceof Error ? err.message : 'Unknown error',
      });
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Enqueue a draft for sync when online.
 */
export async function enqueueForSync(
  entityType: OfflineSyncQueue['entityType'],
  payload: Record<string, unknown>
): Promise<void> {
  await offlineDb.syncQueue.add({
    entityType,
    payload: await encryptOfflinePayload(JSON.stringify(payload)),
    scope_id:
      typeof payload.schedule_id === 'string'
        ? payload.schedule_id
        : typeof payload.patient_id === 'string'
          ? payload.patient_id
          : undefined,
    createdAt: new Date(),
    retryCount: 0,
  });
}

/**
 * Get count of pending sync items.
 */
export async function getPendingSyncCount(): Promise<number> {
  return offlineDb.syncQueue.count();
}

export async function listSyncQueueItems(): Promise<SyncQueueItemSummary[]> {
  const items = await offlineDb.syncQueue.orderBy('createdAt').reverse().toArray();
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      payload:
        parseJson<Record<string, unknown>>(await decryptOfflinePayload(item.payload)) ?? {},
      conflict:
        parseJson<VisitRecordConflictSnapshot>(
          await decryptOfflinePayload(item.conflict_payload)
        ) ?? null,
    }))
  );
}

export async function registerVisitRecordConflict(args: {
  scheduleId: string;
  payload: Record<string, unknown>;
  server: VisitRecordConflictSnapshot['server'];
}): Promise<void> {
  const existing = await offlineDb.syncQueue
    .where('scope_id')
    .equals(args.scheduleId)
    .and((item) => item.entityType === 'visit_record')
    .first();

  const data = {
    entityType: 'visit_record' as const,
    payload: await encryptOfflinePayload(JSON.stringify(args.payload)),
    scope_id: args.scheduleId,
    createdAt: new Date(),
    retryCount: MAX_RETRIES,
    lastError: 'HTTP 409 conflict',
    conflict_state: 'server_conflict' as const,
    conflict_payload: await encryptOfflinePayload(
      JSON.stringify({
        local: args.payload,
        server: args.server,
      } satisfies VisitRecordConflictSnapshot)
    ),
  };

  if (existing?.id) {
    await offlineDb.syncQueue.update(existing.id, data);
    return;
  }

  await offlineDb.syncQueue.add(data);
}

export async function discardSyncQueueItem(itemId: number): Promise<void> {
  const item = await offlineDb.syncQueue.get(itemId);
  if (!item) return;

  await offlineDb.syncQueue.delete(itemId);
  if (item.entityType === 'visit_record' && item.scope_id) {
    await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
  }
}

export async function overwriteVisitRecordConflict(
  config: SyncConfig,
  itemId: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const item = await offlineDb.syncQueue.get(itemId);
  if (!item) return { ok: false, message: '競合対象が見つかりません' };
  if (item.entityType !== 'visit_record') {
    return { ok: false, message: '訪問記録以外の競合は上書きできません' };
  }

  const payload = parseJson<Record<string, unknown>>(await decryptOfflinePayload(item.payload));
  const conflict = parseJson<VisitRecordConflictSnapshot>(
    await decryptOfflinePayload(item.conflict_payload)
  );
  if (!payload || !conflict?.server) {
    return { ok: false, message: '競合情報が不足しています' };
  }

  const endpoint = (config.endpoints.visit_record ?? DEFAULT_ENDPOINTS.visit_record);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': config.orgId,
    },
    body: JSON.stringify({
      ...payload,
      conflict_resolution: 'overwrite',
      existing_record_id: conflict.server.id,
      expected_version: conflict.server.version,
    }),
  });

  if (res.ok) {
    await offlineDb.syncQueue.delete(itemId);
    if (item.scope_id) {
      await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
    }
    return { ok: true };
  }

  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as
      | {
          details?: {
            existing_record?: VisitRecordConflictSnapshot['server'];
          };
        }
      | null;
    await offlineDb.syncQueue.update(itemId, {
      retryCount: MAX_RETRIES,
      lastError: 'HTTP 409 conflict',
      conflict_state: 'server_conflict',
      conflict_payload: await encryptOfflinePayload(
        JSON.stringify({
          local: payload,
          server: body?.details?.existing_record ?? conflict.server,
        } satisfies VisitRecordConflictSnapshot)
      ),
    });
    return { ok: false, message: 'サーバー側の記録が更新されました。差分を確認してください' };
  }

  return { ok: false, message: `上書き保存に失敗しました (HTTP ${res.status})` };
}

/**
 * Setup online listener that triggers sync automatically.
 */
export function setupAutoSync(config: SyncConfig): () => void {
  const handler = () => {
    processSyncQueue(config).catch(() => {
      // Silently fail — will retry next time
    });
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
