import { Buffer } from 'node:buffer';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { validationError } from './input-validation';

export type DynamoCursorKey = Record<string, AttributeValue>;

const DYNAMO_CURSOR_STRING_KEY_ATTRIBUTES = new Set([
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
  'GSI3PK',
  'GSI3SK',
  'GSI4PK',
  'GSI4SK',
  'GSI5PK',
  'GSI5SK',
  'GSI6PK',
  'GSI6SK',
  'GSI7PK',
  'GSI7SK',
  'GSI8PK',
]);

type DynamoCursorDecodeOptions = {
  tenant_id?: string;
};

export function encodeDynamoCursor(key: DynamoCursorKey | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function isStringKeyAttribute(value: unknown): value is { S: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 1 && keys[0] === 'S' && typeof record.S === 'string' && record.S !== '';
}

function assertDynamoCursorKeyShape(parsed: unknown): asserts parsed is DynamoCursorKey {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('cursor must decode to an object');
  }
  const record = parsed as Record<string, unknown>;
  if (!isStringKeyAttribute(record.PK) || !isStringKeyAttribute(record.SK)) {
    throw new Error('cursor must include PH-OS table PK and SK string attributes');
  }
  for (const [key, value] of Object.entries(record)) {
    if (!DYNAMO_CURSOR_STRING_KEY_ATTRIBUTES.has(key) || !isStringKeyAttribute(value)) {
      throw new Error('cursor contains unsupported DynamoDB key attributes');
    }
  }
}

function assertDynamoCursorTenant(key: DynamoCursorKey, options: DynamoCursorDecodeOptions): void {
  if (!options.tenant_id) return;
  const partitionKey = key.PK?.S;
  if (partitionKey !== `TENANT#${options.tenant_id}`) {
    throw new Error('cursor tenant does not match request tenant');
  }
  for (const [attributeName, value] of Object.entries(key)) {
    if (!attributeName.endsWith('PK') || attributeName === 'PK') continue;
    const partitionValue = typeof value.S === 'string' ? value.S : '';
    if (
      partitionValue !== `TENANT#${options.tenant_id}` &&
      !partitionValue.startsWith(`TENANT#${options.tenant_id}#`)
    ) {
      throw new Error('cursor GSI tenant does not match request tenant');
    }
  }
}

export function tenantIdFromDynamoPartitionKey(partition_key: string): string | undefined {
  return partition_key.match(/^TENANT#([^#]+)/)?.[1];
}

export function decodeDynamoCursor(
  cursor: string | undefined,
  options: DynamoCursorDecodeOptions = {},
): DynamoCursorKey | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    assertDynamoCursorKeyShape(parsed);
    assertDynamoCursorTenant(parsed, options);
    return parsed;
  } catch {
    throw validationError({ field: 'cursor' });
  }
}
