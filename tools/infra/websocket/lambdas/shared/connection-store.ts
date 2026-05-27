import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

export type VerifiedConnection = {
  connectionId: string;
  room: string;
  userId: string;
  orgId: string;
  entityType: string;
  entityId: string;
  connectedAt: number;
  expiresAt: number;
  ttl: number;
};

const ddb = new DynamoDBClient({});

function connectionsTableName() {
  const tableName = process.env.CONNECTIONS_TABLE;
  if (!tableName) throw new Error('CONNECTIONS_TABLE is not configured');
  return tableName;
}

function stringAttr(item: Record<string, AttributeValue> | undefined, key: string) {
  const value = item?.[key]?.S;
  if (!value) throw new Error(`Connection record is missing ${key}`);
  return value;
}

function numberAttr(item: Record<string, AttributeValue> | undefined, key: string) {
  const value = item?.[key]?.N;
  if (!value) throw new Error(`Connection record is missing ${key}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Connection record has invalid ${key}`);
  return parsed;
}

function deserializeConnection(item: Record<string, AttributeValue>): VerifiedConnection {
  return {
    connectionId: stringAttr(item, 'connectionId'),
    room: stringAttr(item, 'room'),
    userId: stringAttr(item, 'userId'),
    orgId: stringAttr(item, 'orgId'),
    entityType: stringAttr(item, 'entityType'),
    entityId: stringAttr(item, 'entityId'),
    connectedAt: numberAttr(item, 'connectedAt'),
    expiresAt: numberAttr(item, 'expiresAt'),
    ttl: numberAttr(item, 'ttl'),
  };
}

export async function putConnection(connection: VerifiedConnection) {
  await ddb.send(
    new PutItemCommand({
      TableName: connectionsTableName(),
      Item: {
        connectionId: { S: connection.connectionId },
        room: { S: connection.room },
        userId: { S: connection.userId },
        orgId: { S: connection.orgId },
        entityType: { S: connection.entityType },
        entityId: { S: connection.entityId },
        connectedAt: { N: String(connection.connectedAt) },
        expiresAt: { N: String(connection.expiresAt) },
        ttl: { N: String(connection.ttl) },
      },
    }),
  );
}

export async function deleteConnection(connectionId: string) {
  await ddb.send(
    new DeleteItemCommand({
      TableName: connectionsTableName(),
      Key: {
        connectionId: { S: connectionId },
      },
    }),
  );
}

export async function getConnection(connectionId: string) {
  const result = await ddb.send(
    new GetItemCommand({
      TableName: connectionsTableName(),
      Key: {
        connectionId: { S: connectionId },
      },
    }),
  );

  if (!result.Item) return null;
  return deserializeConnection(result.Item);
}

export async function listConnectionsByRoom(room: string) {
  const connections: VerifiedConnection[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: connectionsTableName(),
        IndexName: 'room-index',
        KeyConditionExpression: '#room = :room',
        ExpressionAttributeNames: {
          '#room': 'room',
        },
        ExpressionAttributeValues: {
          ':room': { S: room },
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    connections.push(...(result.Items ?? []).map(deserializeConnection));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return connections;
}
