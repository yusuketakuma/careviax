import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';

const NAMESPACE = 'CareViaX/Application';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

let _client: CloudWatchClient | null = null;

function getClient(): CloudWatchClient {
  if (!_client) {
    _client = new CloudWatchClient({ region: REGION });
  }
  return _client;
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
      await getClient().send(
        new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData: batch })
      );
    } catch (err) {
      // Metric emission must never break the application
      console.error('[cloudwatch] putMetrics failed', err instanceof Error ? err.message : err);
    }
  }
}

/** Convenience: emit a single count metric. */
export async function putCount(metricName: string, value: number, dimensions?: Record<string, string>): Promise<void> {
  await putMetrics([
    {
      MetricName: metricName,
      Value: value,
      Unit: StandardUnit.Count,
      Timestamp: new Date(),
      Dimensions: dimensions
        ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    },
  ]);
}

/** Convenience: emit a single millisecond latency metric. */
export async function putLatency(metricName: string, milliseconds: number, dimensions?: Record<string, string>): Promise<void> {
  await putMetrics([
    {
      MetricName: metricName,
      Value: milliseconds,
      Unit: StandardUnit.Milliseconds,
      Timestamp: new Date(),
      Dimensions: dimensions
        ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    },
  ]);
}

export { StandardUnit };
export type { MetricDatum };
