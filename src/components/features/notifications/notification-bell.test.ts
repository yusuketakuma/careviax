import { describe, expect, it } from 'vitest';
import { NOTIFICATION_SEEN_ID_LIMIT, pruneSeenNotificationIds } from './notification-bell';

describe('pruneSeenNotificationIds', () => {
  it('caps the seen notification id set while retaining visible ids', () => {
    const seenIds = new Set<string>();
    for (let index = 0; index < 600; index += 1) {
      seenIds.add(`notification_${index}`);
    }

    pruneSeenNotificationIds(seenIds, ['notification_0', 'notification_599']);

    expect(seenIds.size).toBeLessThanOrEqual(NOTIFICATION_SEEN_ID_LIMIT);
    expect(seenIds.has('notification_0')).toBe(true);
    expect(seenIds.has('notification_599')).toBe(true);
  });
});
