import { NextResponse } from 'next/server';
import { error, success } from '@/lib/api/response';
import { logger } from '@/lib/utils/logger';
import { flushPerformanceMetricsToCloudWatch } from '@/lib/utils/performance';

export const FLUSH_METRICS_JOB_TYPE = 'flush-metrics';

const FLUSH_METRICS_OPERATION = 'flush_metrics';
const FLUSH_METRICS_FAILURE_CODE = 'EXTERNAL_JOB_FAILED';

type FlushMetricsJobOptions<TPayload extends Record<string, unknown>> = {
  failureEvent: string;
  failureMessage: string;
  successPayload: () => TPayload;
};

export async function runFlushMetricsJob<TPayload extends Record<string, unknown>>({
  failureEvent,
  failureMessage,
  successPayload,
}: FlushMetricsJobOptions<TPayload>): Promise<NextResponse> {
  try {
    await flushPerformanceMetricsToCloudWatch();
    return success(successPayload());
  } catch (err) {
    logger.error(
      {
        event: failureEvent,
        jobType: FLUSH_METRICS_JOB_TYPE,
        operation: FLUSH_METRICS_OPERATION,
        code: FLUSH_METRICS_FAILURE_CODE,
      },
      err,
    );
    return error(FLUSH_METRICS_FAILURE_CODE, failureMessage, 500);
  }
}
