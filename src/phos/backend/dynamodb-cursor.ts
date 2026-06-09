import { Buffer } from 'node:buffer';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { validationError } from './input-validation';

export type DynamoCursorKey = Record<string, AttributeValue>;

export function encodeDynamoCursor(key: DynamoCursorKey | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeDynamoCursor(cursor: string | undefined): DynamoCursorKey | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('cursor must decode to an object');
    }
    return parsed as DynamoCursorKey;
  } catch {
    throw validationError({ field: 'cursor' });
  }
}
