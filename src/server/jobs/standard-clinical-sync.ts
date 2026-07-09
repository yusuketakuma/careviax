import { drainYreseClinicalSyncQueue } from '@/server/services/standard-clinical-sync-queue';
import { runJob } from './runner';

type YreseClinicalSyncQueueDrainJobContext = {
  orgId?: string;
};

export function drainYreseClinicalSyncQueueJob(
  context: YreseClinicalSyncQueueDrainJobContext = {},
) {
  return runJob(
    'yrese_clinical_sync_queue_drain',
    async () => {
      if (!context.orgId) {
        return {
          processedCount: 0,
          scannedCount: 0,
          errors: ['org_scope_required'],
        };
      }
      return drainYreseClinicalSyncQueue({ orgId: context.orgId });
    },
    context.orgId,
  );
}
