import { describe, expect, it } from 'vitest';
import { readExternalState } from './external-query-state';

describe('external-query-state', () => {
  it('reads supported external focus params', () => {
    expect(
      readExternalState({
        focus: 'self_reports',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialFocus: 'self_reports',
      initialContext: 'dashboard_home',
    });
  });
});
