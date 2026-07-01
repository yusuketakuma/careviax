import { describe, expect, it } from 'vitest';
import { NOTIFICATIONS_API_PATH, buildNotificationsApiPath } from './api-paths';

describe('buildNotificationsApiPath', () => {
  it('builds the notifications collection API path', () => {
    expect(NOTIFICATIONS_API_PATH).toBe('/api/notifications');
    expect(buildNotificationsApiPath()).toBe('/api/notifications');
  });

  it('builds notification collection paths with encoded query params', () => {
    const params = new URLSearchParams({
      limit: '50',
      cursor: 'notice/1?x=y#frag',
    });

    expect(buildNotificationsApiPath(params)).toBe(
      '/api/notifications?limit=50&cursor=notice%2F1%3Fx%3Dy%23frag',
    );
  });
});
