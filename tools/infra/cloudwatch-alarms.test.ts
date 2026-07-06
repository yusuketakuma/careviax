import { afterEach, describe, expect, it, vi } from 'vitest';

const { cloudWatchClientMock, cloudWatchSendMock, snsClientMock, snsSendMock, commandMocks } =
  vi.hoisted(() => ({
    cloudWatchClientMock: vi.fn(),
    cloudWatchSendMock: vi.fn(),
    snsClientMock: vi.fn(function MockSnsClient() {
      return {
        send: snsSendMock,
      };
    }),
    snsSendMock: vi.fn(),
    commandMocks: {
      PutMetricAlarmCommand: vi.fn(function MockPutMetricAlarmCommand(
        this: { input?: unknown },
        input: unknown,
      ) {
        this.input = input;
      }),
      CreateTopicCommand: vi.fn(function MockCreateTopicCommand(
        this: { input?: unknown },
        input: unknown,
      ) {
        this.input = input;
      }),
      SubscribeCommand: vi.fn(function MockSubscribeCommand(
        this: { input?: unknown },
        input: unknown,
      ) {
        this.input = input;
      }),
    },
  }));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: cloudWatchClientMock.mockImplementation(function MockCloudWatchClient() {
    return {
      send: cloudWatchSendMock,
    };
  }),
  PutMetricAlarmCommand: commandMocks.PutMetricAlarmCommand,
}));

describe('cloudwatch alarms infra script', () => {
  const originalArgv = process.argv;
  const originalAwsRegion = process.env.AWS_REGION;
  const originalMaxAttempts = process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  const originalTimeout = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS;

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv = originalArgv;
    if (originalAwsRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalAwsRegion;
    if (originalMaxAttempts === undefined) delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
    else process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = originalMaxAttempts;
    if (originalTimeout === undefined) delete process.env.PHOS_AWS_CLIENT_TIMEOUT_MS;
    else process.env.PHOS_AWS_CLIENT_TIMEOUT_MS = originalTimeout;
  });

  it('does not create the CloudWatch client while importing the module', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    process.env.AWS_REGION = 'ap-northeast-1';
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '9';

    await import('./cloudwatch-alarms');

    expect(cloudWatchClientMock).not.toHaveBeenCalled();
    expect(commandMocks.PutMetricAlarmCommand).not.toHaveBeenCalled();
  });

  it('creates the CloudWatch client lazily with bounded retry config', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    process.env.AWS_REGION = 'ap-northeast-1';
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '9';
    cloudWatchSendMock.mockResolvedValueOnce({ ok: true });
    const { getCloudWatchClient } = await import('./cloudwatch-alarms');

    const client = getCloudWatchClient();
    const command = {} as Parameters<typeof client.send>[0];

    expect(cloudWatchClientMock).toHaveBeenCalledWith({
      region: 'ap-northeast-1',
      maxAttempts: 5,
    });
    await expect(client.send(command)).resolves.toEqual({ ok: true });
    expect(cloudWatchSendMock).toHaveBeenCalledWith(command, {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('reuses CloudWatch clients within a region and separates them across regions', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    const { getCloudWatchClient } = await import('./cloudwatch-alarms');

    expect(getCloudWatchClient('ap-northeast-1')).toBe(getCloudWatchClient('ap-northeast-1'));
    getCloudWatchClient('us-west-2');

    expect(cloudWatchClientMock).toHaveBeenCalledTimes(2);
    expect(cloudWatchClientMock).toHaveBeenNthCalledWith(1, {
      region: 'ap-northeast-1',
      maxAttempts: 2,
    });
    expect(cloudWatchClientMock).toHaveBeenNthCalledWith(2, {
      region: 'us-west-2',
      maxAttempts: 2,
    });
  });

  it('reuses SNS clients within a region and keeps timeout wrapping', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '4';
    snsSendMock.mockResolvedValue({ TopicArn: 'arn:aws:sns:ap-northeast-1:123:topic' });
    const { getSnsClient } = await import('./cloudwatch-alarms');
    const snsModule = {
      SNSClient: snsClientMock,
      CreateTopicCommand: commandMocks.CreateTopicCommand,
      SubscribeCommand: commandMocks.SubscribeCommand,
    };

    const client = getSnsClient(snsModule, 'ap-northeast-1');

    expect(client).toBe(getSnsClient(snsModule, 'ap-northeast-1'));
    getSnsClient(snsModule, 'us-west-2');
    expect(snsClientMock).toHaveBeenCalledTimes(2);
    expect(snsClientMock).toHaveBeenNthCalledWith(1, {
      region: 'ap-northeast-1',
      maxAttempts: 4,
    });
    expect(snsClientMock).toHaveBeenNthCalledWith(2, {
      region: 'us-west-2',
      maxAttempts: 4,
    });

    const command = new commandMocks.CreateTopicCommand({ Name: 'ph-os-prod-alerts' });
    await expect(client.send(command)).resolves.toEqual({
      TopicArn: 'arn:aws:sns:ap-northeast-1:123:topic',
    });
    expect(snsSendMock).toHaveBeenCalledWith(command, {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('normalizes timeout overrides and wraps send calls without replacing caller signals', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    process.env.PHOS_AWS_CLIENT_TIMEOUT_MS = '999999';

    const { infraAwsClientRequestTimeoutMs, withInfraAwsClientTimeout } =
      await import('./cloudwatch-alarms');

    expect(infraAwsClientRequestTimeoutMs()).toBe(30_000);

    const send = vi.fn().mockResolvedValue({ ok: true });
    const client = withInfraAwsClientTimeout({ send }, 1234);

    await expect(client.send({ command: 'PutMetricAlarm' })).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      { command: 'PutMetricAlarm' },
      { abortSignal: expect.any(AbortSignal) },
    );

    const controller = new AbortController();
    await client.send({ command: 'PutMetricAlarm' }, { abortSignal: controller.signal });
    expect(send).toHaveBeenLastCalledWith(
      { command: 'PutMetricAlarm' },
      { abortSignal: controller.signal },
    );
  });

  it('unrefs and clears internally-created timeout timers after infra AWS send resolves', async () => {
    process.argv = ['node', '/tmp/vitest-worker.js'];
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const abortSignalTimeoutSpy =
      typeof AbortSignal.timeout === 'function' ? vi.spyOn(AbortSignal, 'timeout') : null;
    const { withInfraAwsClientTimeout } = await import('./cloudwatch-alarms');
    const send = vi.fn().mockResolvedValue({ ok: true });
    const client = withInfraAwsClientTimeout({ send }, 1234);

    await expect(client.send({ command: 'PutMetricAlarm' })).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledWith(
      { command: 'PutMetricAlarm' },
      { abortSignal: expect.any(AbortSignal) },
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
    expect(abortSignalTimeoutSpy).not.toHaveBeenCalled();
  });

  it('builds alarms that notify SNS on alarm and recovery', async () => {
    const { buildAlarms } = await import('./cloudwatch-alarms');

    const alarms = buildAlarms('arn:aws:sns:ap-northeast-1:123456789012:ph-os-prod-alerts');

    expect(alarms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          AlarmName: 'ph-os-rds-connections-high',
          AlarmActions: ['arn:aws:sns:ap-northeast-1:123456789012:ph-os-prod-alerts'],
          OKActions: ['arn:aws:sns:ap-northeast-1:123456789012:ph-os-prod-alerts'],
          TreatMissingData: 'notBreaching',
        }),
        expect.objectContaining({
          AlarmName: 'ph-os-api-health-down',
          Namespace: 'PH-OS/Application',
          MetricName: 'HealthStatusDown',
        }),
        expect.objectContaining({
          AlarmName: 'ph-os-route-p99-latency-high',
          Namespace: 'PH-OS/Application',
          MetricName: 'OverallP99LatencyMs',
          Dimensions: [{ Name: 'OrgScope', Value: 'aggregate' }],
          DatapointsToAlarm: 2,
          EvaluationPeriods: 3,
          Threshold: 1000,
        }),
        expect.objectContaining({
          AlarmName: 'ph-os-payload-budget-over-routes',
          Namespace: 'PH-OS/Application',
          MetricName: 'PayloadBudgetOverRoutes',
          Dimensions: [{ Name: 'OrgScope', Value: 'aggregate' }],
          EvaluationPeriods: 1,
          Threshold: 0,
        }),
      ]),
    );
  });
});
