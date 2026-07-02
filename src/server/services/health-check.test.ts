import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock, s3SendMock, s3ClientMock, headBucketCommandMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  s3SendMock: vi.fn(),
  s3ClientMock: vi.fn(),
  headBucketCommandMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    send = s3SendMock;

    constructor(config: unknown) {
      s3ClientMock(config);
    }
  },
  HeadBucketCommand: class HeadBucketCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
      headBucketCommandMock(input);
    }
  },
}));

import { checkDatabase, checkS3, runHealthChecks } from './health-check';

describe('health-check', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.S3_BUCKET_NAME;
    delete process.env.S3_BUCKET_REGION;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('checks database connectivity with a cheap select', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    await expect(checkDatabase()).resolves.toMatchObject({ status: 'ok' });
    expect(queryRawMock).toHaveBeenCalledOnce();
  });

  it('returns a safe fixed database message when the database check fails', async () => {
    queryRawMock.mockRejectedValue(new Error('database failed token=secret db_password=value'));

    const result = await checkDatabase();

    expect(result).toMatchObject({
      status: 'down',
      message: 'Database health check failed',
    });
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(result)).not.toContain('db_password=value');
  });

  it('skips S3 without constructing an AWS client when env is incomplete', async () => {
    process.env.S3_BUCKET_NAME = 'ph-os-files';

    await expect(checkS3()).resolves.toMatchObject({
      status: 'ok',
      message: 'S3 env not configured — skipped',
    });
    expect(s3ClientMock).not.toHaveBeenCalled();
    expect(headBucketCommandMock).not.toHaveBeenCalled();
  });

  it('reuses the S3 client for repeated checks in the same region', async () => {
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.AWS_REGION = 'ap-northeast-1';
    s3SendMock.mockResolvedValue({});

    await expect(checkS3()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkS3()).resolves.toMatchObject({ status: 'ok' });

    expect(s3ClientMock).toHaveBeenCalledTimes(1);
    expect(s3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3SendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(headBucketCommandMock).toHaveBeenCalledTimes(2);
    expect(headBucketCommandMock).toHaveBeenNthCalledWith(1, { Bucket: 'ph-os-files' });
    expect(headBucketCommandMock).toHaveBeenNthCalledWith(2, { Bucket: 'ph-os-files' });
  });

  it('returns a safe fixed S3 message when the S3 check fails', async () => {
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.AWS_REGION = 'ap-northeast-1';
    s3SendMock.mockRejectedValue(new Error('s3 failed token=secret db_password=value'));

    const result = await checkS3();

    expect(result).toMatchObject({
      status: 'down',
      message: 'S3 health check failed',
    });
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(result)).not.toContain('db_password=value');
  });

  it('creates a separate S3 client when the health check region changes', async () => {
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.AWS_REGION = 'eu-central-1';
    s3SendMock.mockResolvedValue({});

    await expect(checkS3()).resolves.toMatchObject({ status: 'ok' });
    process.env.AWS_REGION = 'ca-central-1';
    await expect(checkS3()).resolves.toMatchObject({ status: 'ok' });

    expect(s3ClientMock).toHaveBeenCalledTimes(2);
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3SendMock).toHaveBeenCalledTimes(2);
  });

  it('aggregates database and S3 check results', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    await expect(runHealthChecks()).resolves.toMatchObject({
      overall: 'ok',
      checks: {
        database: { status: 'ok' },
        s3: { status: 'ok', message: 'S3 env not configured — skipped' },
      },
    });
  });
});
