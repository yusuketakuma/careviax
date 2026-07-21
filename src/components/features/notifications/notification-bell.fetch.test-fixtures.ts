import { vi } from 'vitest';
import { jsonResponse } from '@/test/fetch-test-utils';

export const notification = {
  id: 'notification_1',
  type: 'business',
  title: '訪問確認',
  message: '患者さんへの連絡確認があります',
  link: '/notifications',
  created_at: '2026-06-10T08:00:00.000Z',
  is_read: false,
};

export const olderNotification = {
  ...notification,
  id: 'notification_21',
  title: '服薬確認',
  message: '確認待ちの通知があります',
  created_at: '2026-06-09T08:00:00.000Z',
};

export const firstPageNotifications = Array.from({ length: 20 }, (_, index) =>
  index === 0
    ? notification
    : {
        ...notification,
        id: `notification_${index + 1}`,
        title: `通知 ${index + 1}`,
        message: `通知メッセージ ${index + 1}`,
      },
);

export function createFetchMock() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/notifications?summary=1') {
      return Promise.resolve(jsonResponse({ data: { unreadCount: 1 } }));
    }
    if (url === '/api/notifications?limit=20') {
      return Promise.resolve(
        jsonResponse({
          data: [notification],
          meta: { limit: 20, has_more: false, next_cursor: null },
        }),
      );
    }
    if (url === '/api/notifications') {
      const message =
        init?.body === JSON.stringify({ all: true }) ? '全て既読にしました' : '1件を既読にしました';
      return Promise.resolve(jsonResponse({ data: { message } }));
    }
    return Promise.resolve(
      jsonResponse({ data: [], meta: { limit: 20, has_more: false, next_cursor: null } }),
    );
  });
}
