import { describe, expect, it } from 'vitest';
import { buildCountedListEnvelope } from './list-envelope';

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
