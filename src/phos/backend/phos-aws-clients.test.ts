import { afterEach, describe, expect, it, vi } from 'vitest';

const { dynamoDbClientMock, s3ClientMock, secretsManagerClientMock, sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  dynamoDbClientMock: vi.fn(function MockDynamoDBClient() {
    return {
      send: sendMock,
    };
  }),
  s3ClientMock: vi.fn(function MockS3Client() {
    return {
      send: sendMock,
    };
  }),
  secretsManagerClientMock: vi.fn(function MockSecretsManagerClient() {
    return {
      send: sendMock,
    };
  }),
}));

vi.mock('@aws-sdk/client-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-dynamodb')>();
  return {
    ...actual,
    DynamoDBClient: dynamoDbClientMock,
  };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: s3ClientMock,
  };
});

vi.mock('@aws-sdk/client-secrets-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-secrets-manager')>();
  return {
    ...actual,
    SecretsManagerClient: secretsManagerClientMock,
  };
});

describe('PH-OS default AWS clients', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.AWS_REGION;
    delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  });

  it('reuses default DynamoDB clients within a region', async () => {
    process.env.AWS_REGION = 'ap-northeast-1';
    const { getDefaultPhosDynamoClient } = await import('./phos-aws-clients');

    expect(getDefaultPhosDynamoClient()).toBe(getDefaultPhosDynamoClient());

    expect(dynamoDbClientMock).toHaveBeenCalledOnce();
    expect(dynamoDbClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('creates separate default DynamoDB clients when the runtime region changes', async () => {
    const { getDefaultPhosDynamoClient } = await import('./phos-aws-clients');

    process.env.AWS_REGION = 'eu-central-1';
    getDefaultPhosDynamoClient();
    process.env.AWS_REGION = 'ca-central-1';
    getDefaultPhosDynamoClient();

    expect(dynamoDbClientMock).toHaveBeenCalledTimes(2);
    expect(dynamoDbClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(dynamoDbClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('reuses default S3 clients within a region with bounded retry config', async () => {
    process.env.AWS_REGION = 'ap-northeast-1';
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '9';
    const { getDefaultPhosS3Client } = await import('./phos-aws-clients');

    expect(getDefaultPhosS3Client()).toBe(getDefaultPhosS3Client());

    expect(s3ClientMock).toHaveBeenCalledOnce();
    expect(s3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 5,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('reuses default Secrets Manager clients within a region', async () => {
    process.env.AWS_REGION = 'ap-northeast-1';
    const { getDefaultPhosSecretsManagerClient } = await import('./phos-aws-clients');

    expect(getDefaultPhosSecretsManagerClient()).toBe(getDefaultPhosSecretsManagerClient());

    expect(secretsManagerClientMock).toHaveBeenCalledOnce();
    expect(secretsManagerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });
});
