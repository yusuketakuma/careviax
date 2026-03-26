'use client';

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
        body: item.payload,
      });

      if (res.ok) {
        await offlineDb.syncQueue.delete(item.id!);
        synced++;
      } else if (res.status === 409) {
        // Conflict — mark as failed and remove from queue
        await offlineDb.syncQueue.delete(item.id!);
        failed++;
      } else {
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${res.status}`,
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
    payload: JSON.stringify(payload),
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
