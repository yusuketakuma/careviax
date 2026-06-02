import { describe, expect, it } from 'vitest';
import { normalizePositiveTimeoutMs } from './timeout';

describe('normalizePositiveTimeoutMs', () => {
  it.each([
    [undefined, 4000],
    ['', 4000],
    ['0', 4000],
    ['-1', 4000],
    ['NaN', 4000],
    [Number.NaN, 4000],
    [Number.POSITIVE_INFINITY, 4000],
    ['12.8', 12],
    [2500, 2500],
  ])('normalizes %p to %p', (value, expected) => {
    expect(normalizePositiveTimeoutMs(value, { fallbackMs: 4000 })).toBe(expected);
  });

  it('caps oversized finite timeout values', () => {
    expect(normalizePositiveTimeoutMs(120_000, { fallbackMs: 4000, maxMs: 60_000 })).toBe(60_000);
  });

  it('falls back when the parsed value is unsafe', () => {
    expect(normalizePositiveTimeoutMs(Number.MAX_SAFE_INTEGER + 10, { fallbackMs: 4000 })).toBe(
      4000,
    );
  });
});
