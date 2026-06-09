import { describe, expect, it } from 'vitest';
import { dynamoEntityMetadata, tenantIdFromDynamoPartitionKey } from './dynamodb-entity-metadata';

describe('PH-OS DynamoDB entity metadata', () => {
  it('derives required entity attributes from tenant-scoped partition keys', () => {
    expect(
      dynamoEntityMetadata({
        partition_key: 'TENANT#tenant_abc123',
        created_at: '2026-06-09T00:00:00.000Z',
        updated_at: '2026-06-09T00:01:00.000Z',
        server_version: 7,
      }),
    ).toEqual({
      tenant_id: { S: 'tenant_abc123' },
      server_version: { N: '7' },
      created_at: { S: '2026-06-09T00:00:00.000Z' },
      updated_at: { S: '2026-06-09T00:01:00.000Z' },
    });
  });

  it('keeps unknown pre-tenant security events explicit instead of omitting tenant_id', () => {
    expect(tenantIdFromDynamoPartitionKey('SECURITY#UNKNOWN')).toBe('UNKNOWN');
  });

  it('rejects non-tenant entity partition keys', () => {
    expect(() => tenantIdFromDynamoPartitionKey('CARD#card_1')).toThrow(/not tenant-scoped/);
  });
});
