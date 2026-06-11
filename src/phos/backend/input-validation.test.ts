import { describe, expect, it } from 'vitest';
import { parseIdempotencyKey, parseRequiredString } from './input-validation';

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

  it('trims required strings and rejects missing values with a validation error by default', () => {
    expect(parseRequiredString(' card_1 ', { field: 'card_id' })).toBe('card_1');

    expect(() => parseRequiredString('   ', { field: 'card_id' })).toThrow(
      expect.objectContaining({
        status: 400,
        error_code: 'VALIDATION_ERROR',
        details: { field: 'card_id' },
      }),
    );
    expect(() => parseRequiredString(123, { field: 'card_id' })).toThrow(
      expect.objectContaining({
        details: { field: 'card_id' },
      }),
    );
  });

  it('can preserve handler-specific error classes for legacy response contracts', () => {
    class CustomValidationError extends Error {}

    expect(() =>
      parseRequiredString(undefined, {
        field: 'mime_type',
        errorFactory: (message) => new CustomValidationError(message),
      }),
    ).toThrow(expect.any(CustomValidationError));
    expect(() =>
      parseRequiredString(undefined, {
        field: 'mime_type',
        errorFactory: (message) => new CustomValidationError(message),
      }),
    ).toThrow('mime_type is required');
  });
});
