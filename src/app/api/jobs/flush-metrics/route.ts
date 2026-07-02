import { NextRequest, NextResponse } from 'next/server';
import { requireApiKeyOrAuthContext } from '@/lib/auth/context';
import { FLUSH_METRICS_JOB_TYPE, runFlushMetricsJob } from '@/server/services/flush-metrics-job';

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

  return runFlushMetricsJob({
    failureEvent: 'job.flush_metrics_failed',
    failureMessage: 'ジョブの実行に失敗しました',
    successPayload: () => ({
      jobType: FLUSH_METRICS_JOB_TYPE,
      flushed_at: new Date().toISOString(),
    }),
  });
}
