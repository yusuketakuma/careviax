import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cloudWatchClientMock, putMetricDataCommandMock, cloudWatchSendMock } = vi.hoisted(() => ({
  cloudWatchSendMock: vi.fn(),
  cloudWatchClientMock: vi.fn(function MockCloudWatchClient() {
    return {
      send: cloudWatchSendMock,
    };
  }),
  putMetricDataCommandMock: vi.fn(function MockPutMetricDataCommand(
    this: { input?: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
}));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: cloudWatchClientMock,
  PutMetricDataCommand: putMetricDataCommandMock,
  StandardUnit: {
    Count: 'Count',
    Milliseconds: 'Milliseconds',
    Percent: 'Percent',
  },
}));

describe('cloudwatch metrics helper', () => {
  beforeEach(() => {
    cloudWatchClientMock.mockClear();
    cloudWatchSendMock.mockReset();
    putMetricDataCommandMock.mockClear();
    process.env.AWS_REGION = 'ap-northeast-1';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AWS_REGION;
  });

  it('batches metrics and reuses the regional CloudWatch client', async () => {
    const { StandardUnit, putMetrics } = await import('./cloudwatch');
    cloudWatchSendMock.mockResolvedValue({});

    await putMetrics([
      { MetricName: 'One', Value: 1, Unit: StandardUnit.Count },
      { MetricName: 'Two', Value: 2, Unit: StandardUnit.Count },
    ]);
    await putMetrics([{ MetricName: 'Three', Value: 3, Unit: StandardUnit.Count }]);

    expect(cloudWatchClientMock).toHaveBeenCalledOnce();
    expect(cloudWatchClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cloudWatchSendMock).toHaveBeenCalledTimes(2);
    expect(cloudWatchSendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(putMetricDataCommandMock).toHaveBeenNthCalledWith(1, {
      Namespace: 'PH-OS/Application',
      MetricData: [
        { MetricName: 'One', Value: 1, Unit: 'Count' },
        { MetricName: 'Two', Value: 2, Unit: 'Count' },
      ],
    });
  });

  it('creates separate cached clients when the runtime AWS region changes', async () => {
    const { StandardUnit, putMetrics } = await import('./cloudwatch');
    cloudWatchSendMock.mockResolvedValue({});

    process.env.AWS_REGION = 'eu-central-1';
    await putMetrics([{ MetricName: 'RegionalEu', Value: 1, Unit: StandardUnit.Count }]);
    process.env.AWS_REGION = 'ca-central-1';
    await putMetrics([{ MetricName: 'RegionalCa', Value: 2, Unit: StandardUnit.Count }]);

    expect(cloudWatchClientMock).toHaveBeenCalledTimes(2);
    expect(cloudWatchClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cloudWatchClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cloudWatchSendMock).toHaveBeenCalledTimes(2);
  });

  it('logs CloudWatch send errors through the safe logger without breaking callers', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { StandardUnit, putMetrics } = await import('./cloudwatch');
    cloudWatchSendMock.mockRejectedValue(
      new Error('cloudwatch down token=secret db_password=value'),
    );

    await expect(
      putMetrics([{ MetricName: 'Failing', Value: 1, Unit: StandardUnit.Count }]),
    ).resolves.toBeUndefined();

    expect(cloudWatchSendMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'cloudwatch.metric_emission_failed',
      event: 'cloudwatch.metric_emission_failed',
      operation: 'put_metrics',
      externalProvider: 'cloudwatch',
      error_name: 'Error',
    });
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');
    const logged = JSON.stringify(entry);
    expect(logged).not.toContain('token=secret');
    expect(logged).not.toContain('db_password=value');
    expect(logged).not.toContain('cloudwatch down');
    errorSpy.mockRestore();
  });
});
