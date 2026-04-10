import { describe, expect, it } from 'vitest';
import { readConferencesState } from './conferences-query-state';

describe('conferences-query-state', () => {
  it('reads supported conferences focus params', () => {
    expect(
      readConferencesState({
        focus: 'activities',
        context: 'dashboard_home',
        view: 'calendar',
        note_type: 'care_team',
      }),
    ).toEqual({
      initialFocus: 'activities',
      initialContext: 'dashboard_home',
      initialViewMode: 'calendar',
      initialNoteType: 'care_team',
    });
  });
});
