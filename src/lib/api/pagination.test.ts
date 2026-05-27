import { describe, expect, it } from 'vitest';

import { parsePaginationParams } from './pagination';

describe('parsePaginationParams', () => {
  it('defaults malformed and out-of-range limits to safe Prisma values', () => {
    expect(parsePaginationParams(new URLSearchParams('limit=abc'))).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('limit=20abc'))).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('limit=1e2'))).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('limit=-5'))).toMatchObject({
      limit: 1,
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('limit=500'))).toMatchObject({
      limit: 100,
      offset: 0,
    });
  });

  it('normalizes numeric cursors without leaking NaN or negative offsets', () => {
    expect(parsePaginationParams(new URLSearchParams('cursor=abc'))).toMatchObject({
      cursor: 'abc',
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('cursor=25abc'))).toMatchObject({
      cursor: '25abc',
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('cursor=-10'))).toMatchObject({
      cursor: '-10',
      offset: 0,
    });
    expect(parsePaginationParams(new URLSearchParams('cursor=25'))).toMatchObject({
      cursor: '25',
      offset: 25,
    });
  });
});
