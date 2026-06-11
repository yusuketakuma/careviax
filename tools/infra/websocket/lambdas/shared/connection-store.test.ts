import { afterEach, describe, expect, it, vi } from 'vitest';

const { dynamoClientMock, dynamoSendMock, commandMocks } = vi.hoisted(() => ({
  dynamoClientMock: vi.fn(),
  dynamoSendMock: vi.fn(),
  commandMocks: {
    PutItemCommand: vi.fn(function MockPutItemCommand(this: { input?: unknown }, input: unknown) {
      this.input = input;
    }),
    DeleteItemCommand: vi.fn(function MockDeleteItemCommand(
      this: { input?: unknown },
      input: unknown,
    ) {
      this.input = input;
    }),
    GetItemCommand: vi.fn(function MockGetItemCommand(this: { input?: unknown }, input: unknown) {
      this.input = input;
    }),
    QueryCommand: vi.fn(function MockQueryCommand(this: { input?: unknown }, input: unknown) {
      this.input = input;
    }),
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: dynamoClientMock.mockImplementation(function MockDynamoDBClient() {
    return {
      send: dynamoSendMock,
    };
  }),
  ...commandMocks,
}));

describe('websocket connection store', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CONNECTIONS_TABLE;
    delete process.env.AWS_REGION;
    delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  });

  it('does not create the DynamoDB client while importing the module', async () => {
    vi.resetModules();

    await import('./connection-store');

    expect(dynamoClientMock).not.toHaveBeenCalled();
  });

  it('creates the DynamoDB client lazily with bounded retry config', async () => {
    vi.resetModules();
    process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS = '4';
    process.env.CONNECTIONS_TABLE = 'ph-os-yjs-connections';
    const { deleteConnection } = await import('./connection-store');

    await deleteConnection('conn_1');

    expect(dynamoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 4,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('reuses DynamoDB clients within a region and separates them across regions', async () => {
    vi.resetModules();
    process.env.CONNECTIONS_TABLE = 'ph-os-yjs-connections';
    const { deleteConnection } = await import('./connection-store');

    process.env.AWS_REGION = 'ap-northeast-1';
    await deleteConnection('conn_1');
    await deleteConnection('conn_2');
    process.env.AWS_REGION = 'us-west-2';
    await deleteConnection('conn_3');

    expect(dynamoClientMock).toHaveBeenCalledTimes(2);
    expect(dynamoClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(dynamoClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'us-west-2',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('stores a verified connection using the token expiry as DynamoDB TTL', async () => {
    process.env.CONNECTIONS_TABLE = 'ph-os-yjs-connections';
    const { putConnection } = await import('./connection-store');

    await putConnection({
      connectionId: 'conn_1',
      room: 'org_1:dispense_task:dt_1',
      userId: 'user_1',
      orgId: 'org_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
      connectedAt: 1779321600,
      expiresAt: 1779321900,
      ttl: 1779321900,
    });

    expect(commandMocks.PutItemCommand).toHaveBeenCalledWith({
      TableName: 'ph-os-yjs-connections',
      Item: {
        connectionId: { S: 'conn_1' },
        room: { S: 'org_1:dispense_task:dt_1' },
        userId: { S: 'user_1' },
        orgId: { S: 'org_1' },
        entityType: { S: 'dispense_task' },
        entityId: { S: 'dt_1' },
        connectedAt: { N: '1779321600' },
        expiresAt: { N: '1779321900' },
        ttl: { N: '1779321900' },
      },
    });
    expect(dynamoSendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('queries room peers through the room-index GSI', async () => {
    process.env.CONNECTIONS_TABLE = 'ph-os-yjs-connections';
    dynamoSendMock
      .mockResolvedValueOnce({
        Items: [
          {
            connectionId: { S: 'conn_1' },
            room: { S: 'org_1:visit_record:vr_1' },
            userId: { S: 'user_1' },
            orgId: { S: 'org_1' },
            entityType: { S: 'visit_record' },
            entityId: { S: 'vr_1' },
            connectedAt: { N: '1779321600' },
            expiresAt: { N: '1779321900' },
            ttl: { N: '1779321900' },
          },
        ],
        LastEvaluatedKey: {
          connectionId: { S: 'conn_1' },
          room: { S: 'org_1:visit_record:vr_1' },
        },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            connectionId: { S: 'conn_2' },
            room: { S: 'org_1:visit_record:vr_1' },
            userId: { S: 'user_2' },
            orgId: { S: 'org_1' },
            entityType: { S: 'visit_record' },
            entityId: { S: 'vr_1' },
            connectedAt: { N: '1779321601' },
            expiresAt: { N: '1779321900' },
            ttl: { N: '1779321900' },
          },
        ],
      });
    const { listConnectionsByRoom } = await import('./connection-store');

    await expect(listConnectionsByRoom('org_1:visit_record:vr_1')).resolves.toEqual([
      {
        connectionId: 'conn_1',
        room: 'org_1:visit_record:vr_1',
        userId: 'user_1',
        orgId: 'org_1',
        entityType: 'visit_record',
        entityId: 'vr_1',
        connectedAt: 1779321600,
        expiresAt: 1779321900,
        ttl: 1779321900,
      },
      {
        connectionId: 'conn_2',
        room: 'org_1:visit_record:vr_1',
        userId: 'user_2',
        orgId: 'org_1',
        entityType: 'visit_record',
        entityId: 'vr_1',
        connectedAt: 1779321601,
        expiresAt: 1779321900,
        ttl: 1779321900,
      },
    ]);

    expect(commandMocks.QueryCommand).toHaveBeenNthCalledWith(1, {
      TableName: 'ph-os-yjs-connections',
      IndexName: 'room-index',
      KeyConditionExpression: '#room = :room',
      ExpressionAttributeNames: {
        '#room': 'room',
      },
      ExpressionAttributeValues: {
        ':room': { S: 'org_1:visit_record:vr_1' },
      },
      ExclusiveStartKey: undefined,
    });
    expect(commandMocks.QueryCommand).toHaveBeenNthCalledWith(2, {
      TableName: 'ph-os-yjs-connections',
      IndexName: 'room-index',
      KeyConditionExpression: '#room = :room',
      ExpressionAttributeNames: {
        '#room': 'room',
      },
      ExpressionAttributeValues: {
        ':room': { S: 'org_1:visit_record:vr_1' },
      },
      ExclusiveStartKey: {
        connectionId: { S: 'conn_1' },
        room: { S: 'org_1:visit_record:vr_1' },
      },
    });
  });

  it('deletes by connectionId primary key only', async () => {
    process.env.CONNECTIONS_TABLE = 'ph-os-yjs-connections';
    const { deleteConnection } = await import('./connection-store');

    await deleteConnection('conn_1');

    expect(commandMocks.DeleteItemCommand).toHaveBeenCalledWith({
      TableName: 'ph-os-yjs-connections',
      Key: {
        connectionId: { S: 'conn_1' },
      },
    });
  });

  it('fails closed when the connection table is not configured', async () => {
    const { getConnection } = await import('./connection-store');

    await expect(getConnection('conn_1')).rejects.toThrow('CONNECTIONS_TABLE is not configured');
    expect(dynamoSendMock).not.toHaveBeenCalled();
  });
});
