import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';

import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';
import { logger } from '@/lib/utils/logger';

const NAMESPACE = 'PH-OS/Application';
const DEFAULT_AWS_REGION = 'ap-northeast-1';
const BATCH_SIZE = 1000;

type PutMetricsOptions = {
  failureMode?: 'swallow' | 'throw';
};

const cloudWatchClients = new Map<string, CloudWatchClient>();

function getClient(region = process.env.AWS_REGION ?? DEFAULT_AWS_REGION): CloudWatchClient {
  const cached = cloudWatchClients.get(region);
  if (cached) return cached;

  const client = withAwsClientTimeout(new CloudWatchClient({ region, ...awsClientConfig() }));
  cloudWatchClients.set(region, client);
  return client;
}

/**
 * Publish custom metrics to CloudWatch.
 * Batches up to 1000 metric data points per API call (AWS limit: 1000).
 * Silently swallows errors by default so metric failures never break request paths.
 * Scheduled jobs can opt into rethrowing after the same PHI-safe error log is emitted.
 */
export async function putMetrics(
  metrics: MetricDatum[],
  options?: PutMetricsOptions,
): Promise<void> {
  if (metrics.length === 0) return;

  for (let offset = 0; offset < metrics.length; offset += BATCH_SIZE) {
    const batch = metrics.slice(offset, offset + BATCH_SIZE);
    try {
      await getClient().send(new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData: batch }));
    } catch (error) {
      // Metric emission must never break the application
      logger.error(
        {
          event: 'cloudwatch.metric_emission_failed',
          operation: 'put_metrics',
          externalProvider: 'cloudwatch',
        },
        error,
      );
      if (options?.failureMode === 'throw') throw error;
    }
  }
}

export { StandardUnit };
export type { MetricDatum };
