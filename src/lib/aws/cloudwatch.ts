import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';

import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';

const NAMESPACE = 'PH-OS/Application';
const DEFAULT_AWS_REGION = 'ap-northeast-1';
const CLOUDWATCH_METRIC_EMISSION_FAILED_MESSAGE = 'CloudWatch metric emission failed';

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
 * Silently swallows errors so metric failures never break the request path.
 */
export async function putMetrics(metrics: MetricDatum[]): Promise<void> {
  if (metrics.length === 0) return;

  // AWS allows max 1000 MetricDatum per PutMetricData call
  const BATCH_SIZE = 1000;
  for (let offset = 0; offset < metrics.length; offset += BATCH_SIZE) {
    const batch = metrics.slice(offset, offset + BATCH_SIZE);
    try {
      await getClient().send(new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData: batch }));
    } catch {
      // Metric emission must never break the application
      console.error('[cloudwatch] putMetrics failed', CLOUDWATCH_METRIC_EMISSION_FAILED_MESSAGE);
    }
  }
}

export { StandardUnit };
export type { MetricDatum };
