import { describe, expect, it } from 'vitest';
import { readMyDayState } from './my-day-query-state';

describe('my-day-query-state', () => {
  it('reads supported My Day search params', () => {
    expect(
      readMyDayState({
        focus: 'visits',
        visit_filter: 'unprepared',
        task_filter: 'urgent',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialFocus: 'visits',
      initialVisitFilter: 'unprepared',
      initialTaskFilter: 'urgent',
      initialContext: 'dashboard_home',
    });
  });

  it('ignores unknown values', () => {
    expect(
      readMyDayState({
        focus: 'weird',
        visit_filter: 'later',
        task_filter: 'soon',
      }),
    ).toEqual({
      initialFocus: undefined,
      initialVisitFilter: undefined,
      initialTaskFilter: undefined,
      initialContext: null,
    });
  });
});
