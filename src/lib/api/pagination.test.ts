import { describe, expect, it } from 'vitest';

import { parseOptionalBoundedIntegerParam, parsePaginationParams } from './pagination';

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

describe('parseOptionalBoundedIntegerParam', () => {
  it('distinguishes omitted values from invalid numeric query strings', () => {
    expect(parseOptionalBoundedIntegerParam(null, 0, 100)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseOptionalBoundedIntegerParam('0', 0, 100)).toEqual({ ok: true, value: 0 });
    expect(parseOptionalBoundedIntegerParam(' 25 ', 0, 100)).toEqual({ ok: true, value: 25 });
  });

  it('rejects malformed, unsafe, and out-of-range values without clamping', () => {
    expect(parseOptionalBoundedIntegerParam('', 0, 100)).toEqual({ ok: false });
    expect(parseOptionalBoundedIntegerParam('1e2', 0, 100)).toEqual({ ok: false });
    expect(parseOptionalBoundedIntegerParam('20abc', 0, 100)).toEqual({ ok: false });
    expect(parseOptionalBoundedIntegerParam('-1', 0, 100)).toEqual({ ok: false });
    expect(parseOptionalBoundedIntegerParam('101', 0, 100)).toEqual({ ok: false });
    expect(parseOptionalBoundedIntegerParam('9007199254740992', 0, 100)).toEqual({ ok: false });
  });
});
