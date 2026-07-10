import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiCursorPageSchema, apiDataSchema } from './response-schemas';

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
    expect(schema.parse({ data: { id: 'row_1' }, meta: { replayed: false } })).toEqual({
      data: { id: 'row_1' },
      meta: { replayed: false },
    });
    expect(schema.safeParse({ id: 'row_1' }).success).toBe(false);
    expect(schema.safeParse({ data: { id: 123 } }).success).toBe(false);
    expect(schema.safeParse({ data: { id: 'row_1' }, legacy_metadata: true }).success).toBe(false);
  });

  it('validates current data/meta cursor pages and normalizes their internal shape', () => {
    const schema = apiCursorPageSchema(z.object({ id: z.string() }));

    expect(
      schema.parse({
        data: [{ id: 'row_1' }],
        meta: { has_more: true, next_cursor: 'cursor_1' },
      }),
    ).toEqual({
      data: [{ id: 'row_1' }],
      hasMore: true,
      nextCursor: 'cursor_1',
    });
    expect(schema.parse({ data: [], meta: { has_more: false, next_cursor: null } })).toEqual({
      data: [],
      hasMore: false,
    });
  });

  it('rejects legacy or internally inconsistent current cursor page envelopes', () => {
    const schema = apiCursorPageSchema(z.object({ id: z.string() }));

    expect(schema.safeParse({ data: [], hasMore: false }).success).toBe(false);
    expect(
      schema.safeParse({ data: [], meta: { has_more: true, next_cursor: null } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ data: [], meta: { has_more: false, next_cursor: 'cursor_1' } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [],
        meta: { has_more: false, next_cursor: null },
        hasMore: false,
      }).success,
    ).toBe(false);
  });

  it('allows provider-specific meta only for the generic pagination client', () => {
    const strictSchema = apiCursorPageSchema(z.object({ id: z.string() }));
    const genericSchema = apiCursorPageSchema(z.object({ id: z.string() }), {
      allowAdditionalMeta: true,
    });
    const payload = {
      data: [{ id: 'row_1' }],
      meta: { has_more: false, next_cursor: null, limit: 100 },
    };

    expect(strictSchema.safeParse(payload).success).toBe(false);
    expect(genericSchema.parse(payload)).toEqual({
      data: [{ id: 'row_1' }],
      hasMore: false,
    });
    expect(genericSchema.safeParse({ ...payload, hasMore: false }).success).toBe(false);
  });
});
