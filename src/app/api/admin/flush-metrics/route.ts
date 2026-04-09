import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { flushPerformanceMetricsToCloudWatch } from '@/lib/utils/performance';

/**
 * POST /api/admin/flush-metrics
 *
 * Flushes in-memory route performance metrics to CloudWatch custom metrics.
 * Call this from a scheduled job every 5 minutes.
 * Requires admin/owner role.
 */
export const POST = withAuth(
  async () => {
    await flushPerformanceMetricsToCloudWatch();
    return NextResponse.json({ ok: true, flushed_at: new Date().toISOString() });
  },
  { permission: 'canAdmin', message: 'メトリクスのフラッシュ権限がありません' }
);
