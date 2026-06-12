import { afterEach, describe, expect, it, vi } from 'vitest';

const { dynamoDbClientMock, dynamoSendMock } = vi.hoisted(() => ({
  dynamoSendMock: vi.fn(),
  dynamoDbClientMock: vi.fn(function MockDynamoDBClient() {
    return {
      send: dynamoSendMock,
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

describe('createLambdaObservabilitySink AWS client defaults', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.AWS_REGION;
    delete process.env.PHOS_SECURITY_EVENTS_DYNAMO;
    delete process.env.PHOS_SECURITY_EVENT_TABLE_NAME;
    delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  });

  it('does not create a DynamoDB security-event client unless persistence is enabled', async () => {
    const { createLambdaObservabilitySink } = await import('./lambda-observability');

    createLambdaObservabilitySink();

    expect(dynamoDbClientMock).not.toHaveBeenCalled();
  });

  it('reuses the default DynamoDB security-event client within a region', async () => {
    process.env.AWS_REGION = 'ap-northeast-1';
    process.env.PHOS_SECURITY_EVENTS_DYNAMO = '1';
    process.env.PHOS_SECURITY_EVENT_TABLE_NAME = 'phos_security_events';
    const { createLambdaObservabilitySink } = await import('./lambda-observability');

    createLambdaObservabilitySink();
    createLambdaObservabilitySink();

    expect(dynamoDbClientMock).toHaveBeenCalledOnce();
    expect(dynamoDbClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
      }),
    );
  });

  it('creates separate default DynamoDB security-event clients when the runtime region changes', async () => {
    process.env.PHOS_SECURITY_EVENTS_DYNAMO = '1';
    process.env.PHOS_SECURITY_EVENT_TABLE_NAME = 'phos_security_events';
    const { createLambdaObservabilitySink } = await import('./lambda-observability');

    process.env.AWS_REGION = 'eu-central-1';
    createLambdaObservabilitySink();
    process.env.AWS_REGION = 'ca-central-1';
    createLambdaObservabilitySink();

    expect(dynamoDbClientMock).toHaveBeenCalledTimes(2);
    expect(dynamoDbClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
      }),
    );
    expect(dynamoDbClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
      }),
    );
  });
});
