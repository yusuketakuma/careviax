/**
 * CloudWatch Alarms Setup Script
 *
 * Creates an SNS topic and sets up CloudWatch alarms for PH-OS production.
 *
 * Usage:
 *   npx ts-node tools/infra/cloudwatch-alarms.ts
 *
 * Required environment variables:
 *   AWS_REGION         ap-northeast-1
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   ALERT_EMAIL        Email address to receive alarm notifications
 *   DB_INSTANCE_ID     RDS instance identifier (e.g. ph-os-prod)
 *   COGNITO_USER_POOL_ID
 */

import {
  CloudWatchClient,
  PutMetricAlarmCommand,
  type PutMetricAlarmCommandInput,
} from '@aws-sdk/client-cloudwatch';
import { maybeUnrefTimeout } from '../shared/abort-timeout';

type SnsModule = {
  SNSClient: new (args: { region: string; maxAttempts?: number }) => {
    send(command: unknown, options?: AwsSendOptions): Promise<{ TopicArn?: string }>;
  };
  CreateTopicCommand: new (args: { Name: string }) => unknown;
  SubscribeCommand: new (args: { TopicArn: string; Protocol: string; Endpoint: string }) => unknown;
};

type AwsSendOptions = {
  abortSignal?: AbortSignal;
  [key: string]: unknown;
};

type AwsSendClient = {
  send(command: unknown, options?: AwsSendOptions): Promise<unknown>;
};

type SnsClient = {
  send(command: unknown, options?: AwsSendOptions): Promise<{ TopicArn?: string }>;
};

const DEFAULT_INFRA_AWS_CLIENT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_INFRA_AWS_CLIENT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_INFRA_AWS_CLIENT_MAX_ATTEMPTS = 2;
const MAX_INFRA_AWS_CLIENT_MAX_ATTEMPTS = 5;
const DEFAULT_AWS_REGION = 'ap-northeast-1';

const ALERT_EMAIL = process.env.ALERT_EMAIL;
const DB_INSTANCE_ID = process.env.DB_INSTANCE_ID ?? 'ph-os-prod';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';

const cachedCloudWatchClients = new Map<string, Pick<CloudWatchClient, 'send'>>();
const cachedSnsClients = new Map<string, SnsClient>();
let cachedSnsModule: Promise<SnsModule | null> | null = null;

function currentAwsRegion() {
  return process.env.AWS_REGION ?? DEFAULT_AWS_REGION;
}

export function getCloudWatchClient(region = currentAwsRegion()) {
  const cachedClient = cachedCloudWatchClients.get(region);
  if (cachedClient) return cachedClient;

  const client = withInfraAwsClientTimeout(
    new CloudWatchClient({ region, ...infraAwsClientConfig() }),
  );
  cachedCloudWatchClients.set(region, client);
  return client;
}

function normalizePositiveInteger(
  value: string | undefined,
  options: {
    fallback: number;
    max: number;
  },
) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return options.fallback;
  return Math.min(parsed, options.max);
}

function createTimeoutController(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('INFRA_AWS_CLIENT_REQUEST_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function infraAwsClientConfig() {
  return {
    maxAttempts: normalizePositiveInteger(process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS, {
      fallback: DEFAULT_INFRA_AWS_CLIENT_MAX_ATTEMPTS,
      max: MAX_INFRA_AWS_CLIENT_MAX_ATTEMPTS,
    }),
  };
}

export function infraAwsClientRequestTimeoutMs(value = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS) {
  return normalizePositiveInteger(value, {
    fallback: DEFAULT_INFRA_AWS_CLIENT_REQUEST_TIMEOUT_MS,
    max: MAX_INFRA_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  });
}

export function withInfraAwsClientTimeout<TClient>(
  client: TClient,
  timeoutMs = infraAwsClientRequestTimeoutMs(),
): TClient {
  const sendClient = client as AwsSendClient;
  return {
    async send(command: unknown, options: AwsSendOptions = {}) {
      if (options.abortSignal) {
        return sendClient.send(command, options);
      }

      const timeout = createTimeoutController(timeoutMs);
      try {
        return await sendClient.send(command, {
          ...options,
          abortSignal: timeout.signal,
        });
      } finally {
        timeout.clear();
      }
    },
  } as TClient;
}

async function loadSnsModule(): Promise<SnsModule> {
  if (!cachedSnsModule) {
    cachedSnsModule = (async () => {
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          specifier: string,
        ) => Promise<unknown>;
        const loaded = await dynamicImport('@aws-sdk/client-sns');
        if (
          loaded &&
          typeof loaded === 'object' &&
          'SNSClient' in loaded &&
          'CreateTopicCommand' in loaded &&
          'SubscribeCommand' in loaded
        ) {
          return loaded as SnsModule;
        }
      } catch {
        return null;
      }

      return null;
    })();
  }

  const snsModule = await cachedSnsModule;
  if (!snsModule) {
    throw new Error(
      'SNS SDK is not installed. Add @aws-sdk/client-sns before running this script.',
    );
  }

  return snsModule;
}

export function getSnsClient(snsModule: SnsModule, region = currentAwsRegion()) {
  const cachedClient = cachedSnsClients.get(region);
  if (cachedClient) return cachedClient;

  const client = withInfraAwsClientTimeout(
    new snsModule.SNSClient({ region, ...infraAwsClientConfig() }),
  );
  cachedSnsClients.set(region, client);
  return client;
}

// ---------------------------------------------------------------------------
// 1. SNS topic
// ---------------------------------------------------------------------------

async function ensureSnsTopic(): Promise<string> {
  const snsModule = await loadSnsModule();
  const sns = getSnsClient(snsModule);

  const res = await sns.send(new snsModule.CreateTopicCommand({ Name: 'ph-os-prod-alerts' }));
  const topicArn = res.TopicArn;
  if (!topicArn) throw new Error('Failed to create SNS topic');

  if (ALERT_EMAIL) {
    await sns.send(
      new snsModule.SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'email',
        Endpoint: ALERT_EMAIL,
      }),
    );
    console.log(`Subscribed ${ALERT_EMAIL} to ${topicArn}`);
  }

  return topicArn;
}

// ---------------------------------------------------------------------------
// 2. Alarm definitions
// ---------------------------------------------------------------------------

export function buildAlarms(topicArn: string): PutMetricAlarmCommandInput[] {
  const common = {
    AlarmActions: [topicArn],
    OKActions: [topicArn],
    TreatMissingData: 'notBreaching' as const,
  };

  return [
    // --- RDS ---
    {
      ...common,
      AlarmName: 'ph-os-rds-connections-high',
      AlarmDescription:
        'RDS database connection count has exceeded the threshold. Review connection pool settings.',
      Namespace: 'AWS/RDS',
      MetricName: 'DatabaseConnections',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: DB_INSTANCE_ID }],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 3,
      Threshold: 80,
      ComparisonOperator: 'GreaterThanThreshold',
    },
    {
      ...common,
      AlarmName: 'ph-os-rds-cpu-high',
      AlarmDescription: 'RDS CPU utilization above 80% for 15 minutes.',
      Namespace: 'AWS/RDS',
      MetricName: 'CPUUtilization',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: DB_INSTANCE_ID }],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 3,
      Threshold: 80,
      ComparisonOperator: 'GreaterThanThreshold',
    },
    {
      ...common,
      AlarmName: 'ph-os-rds-free-storage-low',
      AlarmDescription: 'RDS free storage space is below 10 GiB.',
      Namespace: 'AWS/RDS',
      MetricName: 'FreeStorageSpace',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: DB_INSTANCE_ID }],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 1,
      Threshold: 10 * 1024 * 1024 * 1024, // 10 GiB in bytes
      ComparisonOperator: 'LessThanThreshold',
    },
    {
      ...common,
      AlarmName: 'ph-os-rds-replica-lag-high',
      AlarmDescription: 'RDS replica lag exceeds 30 seconds.',
      Namespace: 'AWS/RDS',
      MetricName: 'ReplicaLag',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: DB_INSTANCE_ID }],
      Statistic: 'Average',
      Period: 60,
      EvaluationPeriods: 3,
      Threshold: 30,
      ComparisonOperator: 'GreaterThanThreshold',
    },

    // --- Cognito ---
    ...(COGNITO_USER_POOL_ID
      ? ([
          {
            ...common,
            AlarmName: 'ph-os-cognito-signin-failures',
            AlarmDescription:
              'Elevated Cognito sign-in failure rate. Possible brute-force or credential-stuffing attack.',
            Namespace: 'AWS/Cognito',
            MetricName: 'SignInSuccesses',
            Dimensions: [
              { Name: 'UserPool', Value: COGNITO_USER_POOL_ID },
              { Name: 'UserPoolClient', Value: 'ALL' },
            ],
            Statistic: 'Sum',
            Period: 300,
            EvaluationPeriods: 2,
            Threshold: 5,
            ComparisonOperator: 'LessThanThreshold',
            TreatMissingData: 'notBreaching' as const,
          },
          {
            ...common,
            AlarmName: 'ph-os-cognito-token-refresh-errors',
            AlarmDescription: 'Cognito token refresh error rate is elevated.',
            Namespace: 'AWS/Cognito',
            MetricName: 'TokenRefreshSuccesses',
            Dimensions: [{ Name: 'UserPool', Value: COGNITO_USER_POOL_ID }],
            Statistic: 'Sum',
            Period: 300,
            EvaluationPeriods: 2,
            Threshold: 1,
            ComparisonOperator: 'LessThanThreshold',
            TreatMissingData: 'notBreaching' as const,
          },
        ] satisfies PutMetricAlarmCommandInput[])
      : []),

    // --- SES ---
    {
      ...common,
      AlarmName: 'ph-os-ses-bounce-rate-high',
      AlarmDescription: 'SES bounce rate is above 5%. Continued bounces risk sending reputation.',
      Namespace: 'AWS/SES',
      MetricName: 'Reputation.BounceRate',
      Statistic: 'Average',
      Period: 3600,
      EvaluationPeriods: 1,
      Threshold: 0.05,
      ComparisonOperator: 'GreaterThanThreshold',
    },
    {
      ...common,
      AlarmName: 'ph-os-ses-complaint-rate-high',
      AlarmDescription: 'SES complaint rate is above 0.1%. Risk of account suspension.',
      Namespace: 'AWS/SES',
      MetricName: 'Reputation.ComplaintRate',
      Statistic: 'Average',
      Period: 3600,
      EvaluationPeriods: 1,
      Threshold: 0.001,
      ComparisonOperator: 'GreaterThanThreshold',
    },

    // --- Application health ---
    {
      ...common,
      AlarmName: 'ph-os-api-health-down',
      AlarmDescription: '/api/health is reporting down status.',
      Namespace: 'PH-OS/Application',
      MetricName: 'HealthStatusDown',
      Dimensions: [{ Name: 'route', Value: '/api/health' }],
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    },
    {
      ...common,
      AlarmName: 'ph-os-api-5xx-rate',
      AlarmDescription: 'API 5xx error count exceeded threshold.',
      Namespace: 'AWS/ApplicationELB',
      MetricName: '5XXError',
      Statistic: 'Sum',
      Period: 60,
      EvaluationPeriods: 3,
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  console.log('Creating SNS topic...');
  const topicArn = await ensureSnsTopic();
  console.log(`SNS Topic ARN: ${topicArn}`);

  const alarms = buildAlarms(topicArn);
  console.log(`\nCreating ${alarms.length} CloudWatch alarms...`);

  const cloudwatch = getCloudWatchClient();
  for (const alarm of alarms) {
    await cloudwatch.send(new PutMetricAlarmCommand(alarm));
    console.log(`  ✓ ${alarm.AlarmName}`);
  }

  console.log('\nDone. All alarms created successfully.');
  console.log(
    '\nNext steps:',
    '\n  1. Confirm the SNS email subscription in your inbox.',
    `\n  2. Verify alarms in the CloudWatch console (${currentAwsRegion()}).`,
    '\n  3. Adjust thresholds in this file as baseline metrics become available.',
  );
}

function isDirectRun() {
  const scriptPath = process.argv[1] ?? '';
  return (
    scriptPath.endsWith('/cloudwatch-alarms.ts') || scriptPath.endsWith('/cloudwatch-alarms.js')
  );
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}
