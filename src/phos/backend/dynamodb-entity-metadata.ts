import type { AttributeValue } from '@aws-sdk/client-dynamodb';

const TENANT_PARTITION_PREFIX = 'TENANT#';
const UNKNOWN_TENANT_ID = 'UNKNOWN';
const UNKNOWN_SECURITY_EVENT_PARTITION = 'SECURITY#UNKNOWN';

export function tenantIdFromDynamoPartitionKey(partition_key: string): string {
  if (partition_key.startsWith(TENANT_PARTITION_PREFIX)) {
    const tenant_id = partition_key.slice(TENANT_PARTITION_PREFIX.length);
    if (tenant_id) return tenant_id;
  }
  if (partition_key === UNKNOWN_SECURITY_EVENT_PARTITION) return UNKNOWN_TENANT_ID;
  throw new Error(`PH-OS DynamoDB entity partition key is not tenant-scoped: ${partition_key}`);
}

export function dynamoEntityMetadata(input: {
  partition_key: string;
  created_at: string;
  updated_at?: string;
  server_version?: number;
}): Record<string, AttributeValue> {
  return {
    tenant_id: { S: tenantIdFromDynamoPartitionKey(input.partition_key) },
    server_version: { N: String(input.server_version ?? 1) },
    created_at: { S: input.created_at },
    updated_at: { S: input.updated_at ?? input.created_at },
  };
}
