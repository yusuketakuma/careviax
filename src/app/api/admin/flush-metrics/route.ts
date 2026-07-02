import { withAuthContext } from '@/lib/auth/context';
import { runFlushMetricsJob } from '@/server/services/flush-metrics-job';

/**
 * POST /api/admin/flush-metrics
 *
 * Flushes in-memory route performance metrics to CloudWatch custom metrics.
 * Call this from a scheduled job every 5 minutes.
 * Requires admin/owner role.
 */
export const POST = withAuthContext(
  async () =>
    runFlushMetricsJob({
      failureEvent: 'admin.flush_metrics_failed',
      failureMessage: 'メトリクスのフラッシュに失敗しました',
      successPayload: () => ({ ok: true, flushed_at: new Date().toISOString() }),
    }),
  { permission: 'canAdmin', message: 'メトリクスのフラッシュ権限がありません' },
);
