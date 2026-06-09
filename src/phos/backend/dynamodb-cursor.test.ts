import { describe, expect, it } from 'vitest';
import {
  decodeDynamoCursor,
  encodeDynamoCursor,
  tenantIdFromDynamoPartitionKey,
  type DynamoCursorKey,
} from './dynamodb-cursor';

function cursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const validKey: DynamoCursorKey = {
  PK: { S: 'TENANT#tenant_abc123' },
  SK: { S: 'CARD#card_1' },
  GSI1PK: { S: 'TENANT#tenant_abc123#BOARD' },
  GSI1SK: { S: 'DUE#2026-06-10#CARD#card_1' },
};

describe('DynamoDB pagination cursor', () => {
  it('round-trips PH-OS DynamoDB string key cursors', () => {
    const encoded = encodeDynamoCursor(validKey);

    expect(
      decodeDynamoCursor(encoded, {
        tenant_id: 'tenant_abc123',
      }),
    ).toEqual(validKey);
  });

  it.each([
    ['array payload', []],
    ['missing table PK', { SK: { S: 'CARD#card_1' } }],
    ['missing table SK', { PK: { S: 'TENANT#tenant_abc123' } }],
    ['unsupported attribute name', { ...validKey, patient_name: { S: 'name' } }],
    ['non-string key attribute', { ...validKey, SK: { N: '1' } }],
    ['multi-shape AttributeValue', { ...validKey, SK: { S: 'CARD#card_1', N: '1' } }],
    ['empty string AttributeValue', { ...validKey, SK: { S: '' } }],
    ['nested map AttributeValue', { ...validKey, SK: { M: { value: { S: 'x' } } } }],
  ])('rejects malformed-but-decodable cursor payloads: %s', (_name, payload) => {
    expect(() => decodeDynamoCursor(cursor(payload))).toThrow(
      expect.objectContaining({
        status: 400,
        error_code: 'VALIDATION_ERROR',
        details: { field: 'cursor' },
      }),
    );
  });

  it('rejects cursors for a different tenant before DynamoDB query execution', () => {
    const encoded = encodeDynamoCursor({
      ...validKey,
      PK: { S: 'TENANT#tenant_other' },
      GSI1PK: { S: 'TENANT#tenant_other#BOARD' },
    });

    expect(() =>
      decodeDynamoCursor(encoded, {
        tenant_id: 'tenant_abc123',
      }),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        error_code: 'VALIDATION_ERROR',
        details: { field: 'cursor' },
      }),
    );
  });

  it('rejects GSI cursor partitions that do not match the request tenant', () => {
    const encoded = encodeDynamoCursor({
      ...validKey,
      GSI1PK: { S: 'TENANT#tenant_other#BOARD' },
    });

    expect(() =>
      decodeDynamoCursor(encoded, {
        tenant_id: 'tenant_abc123',
      }),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        error_code: 'VALIDATION_ERROR',
        details: { field: 'cursor' },
      }),
    );
  });

  it('extracts tenant ids from PH-OS partition keys with optional suffixes', () => {
    expect(tenantIdFromDynamoPartitionKey('TENANT#tenant_abc123')).toBe('tenant_abc123');
    expect(tenantIdFromDynamoPartitionKey('TENANT#tenant_abc123#BOARD')).toBe('tenant_abc123');
    expect(tenantIdFromDynamoPartitionKey('CARD#card_1')).toBeUndefined();
  });
});
