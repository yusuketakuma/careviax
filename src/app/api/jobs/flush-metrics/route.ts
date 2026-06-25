import { NextRequest, NextResponse } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireApiKeyOrAuthContext } from '@/lib/auth/context';
import { flushPerformanceMetricsToCloudWatch } from '@/lib/utils/performance';
import { logger } from '@/lib/utils/logger';

/**
 * POST /api/jobs/flush-metrics
 *
 * Cron/EventBridge から到達可能なメトリクスフラッシュジョブ。
 * 既存の /api/admin/flush-metrics（対話的ADMIN認証）とは別に、
 * JOB_API_KEY 認証で同じフラッシュ処理を呼び出す。
 * 5分間隔のスケジュールから実行する。
 */
export async function POST(req: NextRequest) {
  const authResult = await requireApiKeyOrAuthContext(req, {
    apiKey: process.env.JOB_API_KEY,
    permission: 'canAdmin',
    message: 'ジョブ実行には管理者権限またはAPIキーが必要です',
  });
  if ('response' in authResult) return authResult.response as NextResponse;

  try {
    await flushPerformanceMetricsToCloudWatch();
    return success({
      jobType: 'flush-metrics',
      flushed_at: new Date().toISOString(),
    }) as NextResponse;
  } catch (err) {
    logger.error(
      {
        event: 'job.flush_metrics_failed',
        jobType: 'flush-metrics',
        operation: 'flush_metrics',
        code: 'EXTERNAL_JOB_FAILED',
      },
      err,
    );
    return error('EXTERNAL_JOB_FAILED', 'ジョブの実行に失敗しました', 500) as NextResponse;
  }
}
