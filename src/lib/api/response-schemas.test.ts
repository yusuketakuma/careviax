import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiDataSchema,
  cursorPaginatedPageSchema,
  normalizeCursorPaginatedPagePayload,
} from './response-schemas';

describe('response-schemas', () => {
  it('validates the shared data envelope shape', () => {
    const schema = apiDataSchema(
      z.object({
        id: z.string(),
      }),
    );

    expect(schema.parse({ data: { id: 'row_1' } })).toEqual({
      data: { id: 'row_1' },
    });
    expect(schema.safeParse({ id: 'row_1' }).success).toBe(false);
    expect(schema.safeParse({ data: { id: 123 } }).success).toBe(false);
  });

  it('validates cursor page responses with explicit hasMore state', () => {
    const schema = cursorPaginatedPageSchema(
      z.object({
        id: z.string(),
      }),
    );

    expect(schema.safeParse({ data: [{ id: 'row_1' }] }).success).toBe(false);
    expect(schema.parse({ data: [{ id: 'row_1' }], hasMore: false })).toEqual({
      data: [{ id: 'row_1' }],
      hasMore: false,
    });
    expect(
      schema.parse({
        data: [{ id: 'row_1' }],
        hasMore: true,
        nextCursor: 'row_1',
      }),
    ).toEqual({
      data: [{ id: 'row_1' }],
      hasMore: true,
      nextCursor: 'row_1',
    });
  });

  it('rejects malformed cursor page responses', () => {
    const schema = cursorPaginatedPageSchema(z.object({ id: z.string() }));

    expect(schema.safeParse({ data: { id: 'not-array' }, hasMore: false }).success).toBe(false);
    expect(schema.safeParse({ data: [{ id: 'row_1' }], nextCursor: 123 }).success).toBe(false);
    expect(schema.safeParse({ data: [{ id: 'row_1' }], hasMore: true }).success).toBe(false);
    expect(
      schema.safeParse({ data: [{ id: 'row_1' }], hasMore: true, nextCursor: '   ' }).success,
    ).toBe(false);
  });

  it('normalizes cursor page payloads while preserving metadata', () => {
    const normalized = normalizeCursorPaginatedPagePayload(
      {
        data: [{ id: 'row_1' }],
        hasMore: true,
        nextCursor: 'row_1',
        deliverySummary: { pending_delivery_count: 2 },
      },
      z.object({ id: z.string() }),
    );

    expect(normalized).toEqual({
      page: {
        data: [{ id: 'row_1' }],
        hasMore: true,
        nextCursor: 'row_1',
      },
      metadata: {
        deliverySummary: { pending_delivery_count: 2 },
      },
    });
  });

  it('rejects normalized cursor payloads with malformed items or missing cursors', () => {
    const itemSchema = z.object({ id: z.string() });

    expect(
      normalizeCursorPaginatedPagePayload({ data: [{ id: 123 }], hasMore: false }, itemSchema),
    ).toBeNull();
    expect(
      normalizeCursorPaginatedPagePayload({ data: [{ id: 'row_1' }], hasMore: true }, itemSchema),
    ).toBeNull();
  });
});
