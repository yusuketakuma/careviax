import { describe, expect, it } from 'vitest';
import {
  buildCountedListEnvelope,
  buildCountedListResponse,
  buildCursorListEnvelope,
  buildListEnvelope,
} from './list-envelope';

const GENERATED_AT = new Date('2026-07-16T00:00:00.000Z');

describe('canonical list envelopes', () => {
  it('injects generated_at before route-specific metadata', () => {
    const envelope = buildListEnvelope(
      [{ id: 'row_1' }],
      { count_basis: 'visible_rows' },
      GENERATED_AT,
    );

    expect(Object.keys(envelope)).toEqual(['data', 'meta']);
    expect(Object.keys(envelope.meta)).toEqual(['generated_at', 'count_basis']);
    expect(envelope).toEqual({
      data: [{ id: 'row_1' }],
      meta: {
        generated_at: '2026-07-16T00:00:00.000Z',
        count_basis: 'visible_rows',
      },
    });
  });

  it('normalizes a cursor page into canonical wire metadata', () => {
    expect(
      buildCursorListEnvelope(
        { data: [{ id: 'row_1' }], hasMore: true, nextCursor: 'cursor_1' },
        100,
        GENERATED_AT,
      ),
    ).toEqual({
      data: [{ id: 'row_1' }],
      meta: {
        generated_at: '2026-07-16T00:00:00.000Z',
        limit: 100,
        has_more: true,
        next_cursor: 'cursor_1',
      },
    });
    expect(buildCursorListEnvelope({ data: [], hasMore: false }, 100, GENERATED_AT).meta).toEqual({
      generated_at: '2026-07-16T00:00:00.000Z',
      limit: 100,
      has_more: false,
      next_cursor: null,
    });
  });

  it('normalizes counted data into canonical generated metadata', () => {
    const envelope = buildCountedListResponse(
      [{ id: 'row_1' }],
      3,
      { count_basis: 'example_rows', limit: 100 },
      GENERATED_AT,
    );

    expect(Object.keys(envelope)).toEqual(['data', 'meta']);
    expect(Object.keys(envelope.meta)).toEqual([
      'generated_at',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
      'count_basis',
      'limit',
    ]);
    expect(envelope).toEqual({
      data: [{ id: 'row_1' }],
      meta: {
        generated_at: '2026-07-16T00:00:00.000Z',
        total_count: 3,
        visible_count: 1,
        hidden_count: 2,
        truncated: true,
        count_basis: 'example_rows',
        limit: 100,
      },
    });
  });

  it.each([-1, 1.5, Number.NaN])('rejects an invalid canonical total count (%s)', (totalCount) => {
    expect(() =>
      buildCountedListResponse([], totalCount, { count_basis: 'example_rows' }, GENERATED_AT),
    ).toThrow('total count must be non-negative');
  });

  it('fails closed for invalid cursor relations and limits', () => {
    expect(() => buildCursorListEnvelope({ data: [], hasMore: true }, 100, GENERATED_AT)).toThrow(
      'next cursor must match has more',
    );
    expect(() =>
      buildCursorListEnvelope(
        { data: [], hasMore: false, nextCursor: 'cursor_1' },
        100,
        GENERATED_AT,
      ),
    ).toThrow('next cursor must match has more');
    expect(() =>
      buildCursorListEnvelope({ data: [], hasMore: false, nextCursor: '' }, 100, GENERATED_AT),
    ).toThrow('next cursor must match has more');
    expect(() => buildCursorListEnvelope({ data: [], hasMore: false }, 0, GENERATED_AT)).toThrow(
      'limit must be a positive integer',
    );
  });
});

describe('buildCountedListEnvelope', () => {
  it('preserves the counted-list JSON key order and truncation metadata', () => {
    const envelope = buildCountedListEnvelope([{ id: 'row_1' }], 3);

    expect(Object.keys(envelope)).toEqual([
      'data',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
    ]);
    expect(JSON.stringify(envelope)).toBe(
      '{"data":[{"id":"row_1"}],"total_count":3,"visible_count":1,"hidden_count":2,"truncated":true}',
    );
  });

  it('floors hidden_count at zero when a count source is behind the visible rows', () => {
    expect(buildCountedListEnvelope([{ id: 'row_1' }, { id: 'row_2' }], 1)).toEqual({
      data: [{ id: 'row_1' }, { id: 'row_2' }],
      total_count: 1,
      visible_count: 2,
      hidden_count: 0,
      truncated: false,
    });
  });

  it('keeps route metadata appended after the counted-list fields', () => {
    const responseBody = {
      ...buildCountedListEnvelope([{ id: 'row_1' }], 1),
      count_basis: 'example_rows',
      filters_applied: {},
      limit: 100,
    };

    expect(Object.keys(responseBody)).toEqual([
      'data',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
      'count_basis',
      'filters_applied',
      'limit',
    ]);
    expect(JSON.stringify(responseBody)).toBe(
      '{"data":[{"id":"row_1"}],"total_count":1,"visible_count":1,"hidden_count":0,"truncated":false,"count_basis":"example_rows","filters_applied":{},"limit":100}',
    );
  });
});
