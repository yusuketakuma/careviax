import { describe, expect, it } from 'vitest';
import { readNotificationsState } from './notifications-query-state';

describe('notifications-query-state', () => {
  it('reads supported notifications params', () => {
    expect(
      readNotificationsState({
        tab: 'all',
        type: 'urgent',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialTab: 'all',
      initialTypeFilter: 'urgent',
      initialContext: 'dashboard_home',
    });
  });

  it('ignores unsupported values', () => {
    expect(
      readNotificationsState({
        tab: 'later',
        type: 'other',
      }),
    ).toEqual({
      initialTab: undefined,
      initialTypeFilter: undefined,
      initialContext: null,
    });
  });
});
