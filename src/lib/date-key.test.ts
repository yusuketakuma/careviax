import { describe, expect, it } from 'vitest';

import {
  formatDateKey,
  formatNullableDateKey,
  formatNullableUtcDateKey,
  formatUtcDateKey,
} from './date-key';

describe('date-key helpers', () => {
  it('formats a Date using the local calendar day', () => {
    expect(formatDateKey(new Date(2026, 2, 30, 0, 0, 0))).toBe('2026-03-30');
  });

  it('pads month and day components', () => {
    expect(formatDateKey(new Date(2026, 0, 5, 12, 34, 56))).toBe('2026-01-05');
  });

  it('formats nullable date keys', () => {
    expect(formatNullableDateKey(new Date(2026, 6, 9))).toBe('2026-07-09');
    expect(formatNullableDateKey(null)).toBeNull();
    expect(formatNullableDateKey(undefined)).toBeNull();
  });

  it('throws for invalid local Date values', () => {
    const invalidDate = new Date('not-a-date');

    expect(() => formatDateKey(invalidDate)).toThrow(RangeError);
    expect(() => formatNullableDateKey(invalidDate)).toThrow(RangeError);
  });

  it('formats a Date using the UTC calendar day', () => {
    expect(formatUtcDateKey(new Date('2026-03-30T00:30:00.000Z'))).toBe('2026-03-30');
  });

  it('formats nullable UTC date keys', () => {
    expect(formatNullableUtcDateKey(new Date('2026-07-09T12:34:56.000Z'))).toBe('2026-07-09');
    expect(formatNullableUtcDateKey(null)).toBeNull();
    expect(formatNullableUtcDateKey(undefined)).toBeNull();
  });

  it('throws for invalid UTC Date values', () => {
    const invalidDate = new Date('not-a-date');

    expect(() => formatUtcDateKey(invalidDate)).toThrow(RangeError);
    expect(() => formatNullableUtcDateKey(invalidDate)).toThrow(RangeError);
  });
});
