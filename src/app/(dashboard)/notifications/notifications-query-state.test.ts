import { describe, expect, it } from 'vitest';
import { readNotificationsState } from './notifications-query-state';

describe('notifications-query-state', () => {
  it('reads the category param directly', () => {
    expect(readNotificationsState({ category: 'pharmacist' })).toEqual({
      initialCategory: 'pharmacist',
    });
    expect(readNotificationsState({ category: 'unsynced' })).toEqual({
      initialCategory: 'unsynced',
    });
  });

  it('ignores unsupported values', () => {
    expect(readNotificationsState({ category: 'other', type: 'urgent', tab: 'later' })).toEqual({});
    expect(readNotificationsState(null)).toEqual({});
  });
});
