import { describe, expect, it } from 'vitest';

import { buildPagination } from './search';

describe('buildPagination', () => {
  it('sanitizes non-finite, fractional, and out-of-range page inputs', () => {
    expect(buildPagination(Number.NaN, Number.NaN)).toEqual({ skip: 0, take: 20 });
    expect(buildPagination(-3, -10)).toEqual({ skip: 0, take: 1 });
    expect(buildPagination(2.8, 10.9)).toEqual({ skip: 10, take: 10 });
    expect(buildPagination(2, 500)).toEqual({ skip: 100, take: 100 });
  });
});
