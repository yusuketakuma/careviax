import { afterEach, describe, expect, it, vi } from 'vitest';

const { dynamoSendMock, commandMocks } = vi.hoisted(() => ({
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
  DynamoDBClient: vi.fn().mockImplementation(function MockDynamoDBClient() {
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
