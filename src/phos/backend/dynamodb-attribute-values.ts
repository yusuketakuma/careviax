import type { AttributeValue } from '@aws-sdk/client-dynamodb';

type JsonRecord = Record<string, unknown>;

export function toDynamoAttributeValue(value: unknown): AttributeValue {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map((item) => toDynamoAttributeValue(item)) };
  if (typeof value === 'object') {
    const input = value as JsonRecord;
    return {
      M: Object.fromEntries(
        Object.entries(input)
          .filter(([, entryValue]) => entryValue !== undefined)
          .map(([key, entryValue]) => [key, toDynamoAttributeValue(entryValue)]),
      ),
    };
  }
  throw new Error(`Unsupported DynamoDB attribute value type: ${typeof value}`);
}

export function fromDynamoAttributeValue(value: AttributeValue): unknown {
  if ('S' in value) return value.S;
  if ('N' in value) return Number(value.N);
  if ('BOOL' in value) return value.BOOL;
  if ('NULL' in value) return null;
  if ('L' in value) return (value.L ?? []).map((item) => fromDynamoAttributeValue(item));
  if ('M' in value) {
    return Object.fromEntries(
      Object.entries(value.M ?? {}).map(([key, entryValue]) => [
        key,
        fromDynamoAttributeValue(entryValue),
      ]),
    );
  }
  if ('SS' in value) return value.SS ?? [];
  if ('NS' in value) return (value.NS ?? []).map((item) => Number(item));
  if ('BS' in value) return value.BS ?? [];
  if ('B' in value) return value.B;
  throw new Error('Unsupported DynamoDB attribute value shape');
}

export function dynamoKey(partition_key: string, sort_key: string): Record<string, AttributeValue> {
  return {
    PK: { S: partition_key },
    SK: { S: sort_key },
  };
}
