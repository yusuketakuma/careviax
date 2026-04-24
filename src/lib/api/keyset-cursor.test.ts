import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor';

describe('keyset-cursor', () => {
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

  it('returns null for malformed cursors or missing keys', () => {
    expect(decodeKeysetCursor(['created_at'] as const, 'not-base64-json')).toBeNull();
    expect(
      decodeKeysetCursor(
        ['created_at'] as const,
        Buffer.from(JSON.stringify({ id: 'row_1' }), 'utf8').toString('base64url'),
      ),
    ).toBeNull();
  });
});
