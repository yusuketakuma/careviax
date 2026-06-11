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

  it('maps legacy type params onto the five categories', () => {
    expect(readNotificationsState({ type: 'urgent' })).toEqual({ initialCategory: 'urgent' });
    expect(readNotificationsState({ type: 'business' })).toEqual({ initialCategory: 'clerk' });
    expect(readNotificationsState({ type: 'reminder' })).toEqual({ initialCategory: 'reply' });
    expect(readNotificationsState({ type: 'system' })).toEqual({ initialCategory: 'all' });
  });

  it('ignores unsupported values', () => {
    expect(readNotificationsState({ category: 'other', type: 'other', tab: 'later' })).toEqual({});
    expect(readNotificationsState(null)).toEqual({});
  });
});
