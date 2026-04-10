import { describe, expect, it } from 'vitest';
import { readHandoffState } from './handoff-query-state';

describe('handoff-query-state', () => {
  it('reads supported handoff params', () => {
    expect(
      readHandoffState({
        date: '2026-04-10',
        filter: 'unread',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialDate: '2026-04-10',
      initialFilter: 'unread',
      initialContext: 'dashboard_home',
    });
  });

  it('ignores invalid handoff dates', () => {
    expect(
      readHandoffState({
        date: 'later',
        filter: 'other',
      }),
    ).toEqual({
      initialDate: undefined,
      initialFilter: undefined,
      initialContext: null,
    });
  });
});
