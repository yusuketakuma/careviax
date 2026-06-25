import { NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { error } from '@/lib/api/response';
import { flushPerformanceMetricsToCloudWatch } from '@/lib/utils/performance';
import { logger } from '@/lib/utils/logger';

/**
 * POST /api/admin/flush-metrics
 *
 * Flushes in-memory route performance metrics to CloudWatch custom metrics.
 * Call this from a scheduled job every 5 minutes.
 * Requires admin/owner role.
 */
export const POST = withAuthContext(
  async () => {
    try {
      await flushPerformanceMetricsToCloudWatch();
      return NextResponse.json({ ok: true, flushed_at: new Date().toISOString() });
    } catch (err) {
      logger.error(
        {
          event: 'admin.flush_metrics_failed',
          jobType: 'flush-metrics',
          operation: 'flush_metrics',
          code: 'EXTERNAL_JOB_FAILED',
        },
        err,
      );
      return error('EXTERNAL_JOB_FAILED', 'メトリクスのフラッシュに失敗しました', 500);
    }
  },
  { permission: 'canAdmin', message: 'メトリクスのフラッシュ権限がありません' },
);
