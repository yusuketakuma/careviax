import { describe, expect, it } from 'vitest';
import { parseOptionalIdempotencyKey } from './idempotency-key';

describe('parseOptionalIdempotencyKey', () => {
  it('treats a missing header as absent but valid', () => {
    expect(parseOptionalIdempotencyKey(null)).toEqual({ ok: true, key: null });
  });

  it('trims and accepts the route-wide compatible key character set', () => {
    expect(parseOptionalIdempotencyKey(' key.AZ-09_: ')).toEqual({
      ok: true,
      key: 'key.AZ-09_:',
    });
  });

  it('rejects blank, overlong, and unsupported key values', () => {
    for (const value of ['', '   ', 'bad key', 'bad/key', 'x'.repeat(129)]) {
      expect(parseOptionalIdempotencyKey(value)).toEqual({
        ok: false,
        message: 'Idempotency-Keyが不正です',
      });
    }
  });
});
