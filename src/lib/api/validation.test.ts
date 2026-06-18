import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  boundedIntegerSearchParam,
  optionalBlankableBoundedIntegerSearchParam,
  optionalBoundedIntegerSearchParam,
  parseSearchParams,
} from './validation';

describe('boundedIntegerSearchParam', () => {
  const schema = z.object({
    limit: boundedIntegerSearchParam('limit', 1, 100, 25),
  });

  it('applies defaults and accepts canonical integer query strings', () => {
    expect(parseSearchParams(schema, new URLSearchParams())).toEqual({
      ok: true,
      data: { limit: 25 },
    });
    expect(parseSearchParams(schema, new URLSearchParams('limit=10'))).toEqual({
      ok: true,
      data: { limit: 10 },
    });
    expect(parseSearchParams(schema, new URLSearchParams('limit=%2010%20'))).toEqual({
      ok: true,
      data: { limit: 10 },
    });
  });

  it('rejects blank, exponent, decimal, partial, and out-of-range values', () => {
    for (const value of ['', '1e2', '10.0', '10abc', '0', '101']) {
      const result = parseSearchParams(schema, new URLSearchParams([['limit', value]]));
      expect(result.ok).toBe(false);
    }
  });
});

describe('optionalBoundedIntegerSearchParam', () => {
  const schema = z.object({
    limit: optionalBoundedIntegerSearchParam('limit', 1, 100),
  });

  it('preserves omitted params and accepts canonical integer query strings', () => {
    expect(parseSearchParams(schema, new URLSearchParams())).toEqual({
      ok: true,
      data: {},
    });
    expect(parseSearchParams(schema, new URLSearchParams('limit=10'))).toEqual({
      ok: true,
      data: { limit: 10 },
    });
    expect(parseSearchParams(schema, new URLSearchParams('limit=%2010%20'))).toEqual({
      ok: true,
      data: { limit: 10 },
    });
  });

  it('rejects blank, exponent, decimal, partial, and out-of-range values', () => {
    for (const value of ['', '1e2', '10.0', '10abc', '0', '101']) {
      const result = parseSearchParams(schema, new URLSearchParams([['limit', value]]));
      expect(result.ok).toBe(false);
    }
  });
});

describe('optionalBlankableBoundedIntegerSearchParam', () => {
  const schema = z.object({
    offset: optionalBlankableBoundedIntegerSearchParam('offset', 0, 100),
  });

  it('treats blank values as omitted while preserving integer validation', () => {
    expect(parseSearchParams(schema, new URLSearchParams('offset='))).toEqual({
      ok: true,
      data: {},
    });
    expect(parseSearchParams(schema, new URLSearchParams('offset=%2020%20'))).toEqual({
      ok: true,
      data: { offset: 20 },
    });
  });

  it('rejects malformed and out-of-range values', () => {
    for (const value of ['1e2', '10.0', '10abc', '-1', '101']) {
      const result = parseSearchParams(schema, new URLSearchParams([['offset', value]]));
      expect(result.ok).toBe(false);
    }
  });
});
