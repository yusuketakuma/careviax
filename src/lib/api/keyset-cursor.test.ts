import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor';

describe('keyset-cursor', () => {
  function encodePayload(payload: unknown) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  it('encodes and decodes date keysets with an id', () => {
    const cursor = encodeKeysetCursor(['created_at'] as const, {
      id: 'row_1',
      created_at: new Date('2026-04-20T10:00:00.000Z'),
    });

    expect(decodeKeysetCursor(['created_at'] as const, cursor)).toEqual({
      id: 'row_1',
      created_at: new Date('2026-04-20T10:00:00.000Z'),
    });
  });

  it('decodes every requested date key before returning a cursor', () => {
    const cursor = encodeKeysetCursor(['created_at', 'updated_at'] as const, {
      id: 'row_1',
      created_at: '2026-04-20T10:00:00.000Z',
      updated_at: '2026-04-21T11:30:00.000Z',
    });

    expect(decodeKeysetCursor(['created_at', 'updated_at'] as const, cursor)).toEqual({
      id: 'row_1',
      created_at: new Date('2026-04-20T10:00:00.000Z'),
      updated_at: new Date('2026-04-21T11:30:00.000Z'),
    });
  });

  it('returns null for malformed cursors or missing keys', () => {
    expect(decodeKeysetCursor(['created_at'] as const, 'not-base64-json')).toBeNull();
    expect(
      decodeKeysetCursor(
        ['created_at'] as const,
        Buffer.from('{bad json', 'utf8').toString('base64url'),
      ),
    ).toBeNull();
    expect(decodeKeysetCursor(['created_at'] as const, encodePayload({ id: 'row_1' }))).toBeNull();
  });

  it('returns null for non-object payloads and non-string cursor fields', () => {
    expect(decodeKeysetCursor(['created_at'] as const, encodePayload([]))).toBeNull();
    expect(decodeKeysetCursor(['created_at'] as const, encodePayload(null))).toBeNull();
    expect(decodeKeysetCursor(['created_at'] as const, encodePayload(123))).toBeNull();
    expect(
      decodeKeysetCursor(
        ['created_at'] as const,
        encodePayload({ id: 123, created_at: '2026-04-20T10:00:00.000Z' }),
      ),
    ).toBeNull();
    expect(
      decodeKeysetCursor(['created_at'] as const, encodePayload({ id: 'row_1', created_at: 123 })),
    ).toBeNull();
    expect(
      decodeKeysetCursor(
        ['created_at'] as const,
        encodePayload({ id: '   ', created_at: '2026-04-20T10:00:00.000Z' }),
      ),
    ).toBeNull();
  });
});
