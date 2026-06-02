import { describe, expect, it } from 'vitest';
import { parseJsonObjectOrNull, parseJsonOrNull } from './json';

describe('JSON parsing helpers', () => {
  it('parses valid JSON while keeping the result unknown-shaped', () => {
    expect(parseJsonOrNull('{"id":"record-1","count":2}')).toEqual({
      id: 'record-1',
      count: 2,
    });
    expect(parseJsonOrNull('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns null for missing or malformed JSON text', () => {
    expect(parseJsonOrNull(null)).toBeNull();
    expect(parseJsonOrNull(undefined)).toBeNull();
    expect(parseJsonOrNull('')).toBeNull();
    expect(parseJsonOrNull('not-json')).toBeNull();
  });

  it('parses only object roots when callers need a record payload', () => {
    expect(parseJsonObjectOrNull('{"id":"record-1"}')).toEqual({ id: 'record-1' });
    expect(parseJsonObjectOrNull('[{"id":"record-1"}]')).toBeNull();
    expect(parseJsonObjectOrNull('"record-1"')).toBeNull();
    expect(parseJsonObjectOrNull('null')).toBeNull();
    expect(parseJsonObjectOrNull('not-json')).toBeNull();
  });
});
