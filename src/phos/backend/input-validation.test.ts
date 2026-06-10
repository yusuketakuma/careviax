import { describe, expect, it } from 'vitest';
import { parseIdempotencyKey } from './input-validation';

describe('PH-OS input validation', () => {
  it('normalizes bounded idempotency keys before they reach DynamoDB keys', () => {
    expect(parseIdempotencyKey(' idem_1:retry-2.client ')).toBe('idem_1:retry-2.client');
  });

  it('rejects idempotency keys that are empty, too long, or unsafe for audit keys', () => {
    for (const value of [
      '',
      '   ',
      'x'.repeat(129),
      'idem/1',
      'idem 1',
      'idem\n1',
      '\u51e6\u65b9idem1',
    ]) {
      expect(() => parseIdempotencyKey(value)).toThrow(
        expect.objectContaining({
          status: 400,
          error_code: 'VALIDATION_ERROR',
          details: expect.objectContaining({ field: 'idempotency_key' }),
        }),
      );
    }
  });
});
