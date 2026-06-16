import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationStreamPayload,
  parseNotificationStreamPayload,
} from './stream-payload';

describe('parseNotificationStreamPayload', () => {
  it('returns valid notification stream items', () => {
    expect(
      parseNotificationStreamPayload(
        JSON.stringify([
          {
            id: 'notification_1',
            type: 'urgent',
            title: '緊急通知',
            message: '確認してください',
            link: '/workflow',
            is_read: false,
            created_at: '2026-05-31T00:00:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'notification_1',
        type: 'urgent',
        title: '緊急通知',
        message: '確認してください',
        link: '/workflow',
        is_read: false,
        created_at: '2026-05-31T00:00:00.000Z',
      },
    ]);
  });

  it('ignores malformed chunks and malformed rows', () => {
    expect(parseNotificationStreamPayload('not-json')).toEqual([]);
    expect(parseNotificationStreamPayload(JSON.stringify({ id: 'notification_1' }))).toEqual([]);
    expect(
      parseNotificationStreamPayload(
        JSON.stringify([
          ['unexpected'],
          {
            id: 'notification_1',
            type: 'unknown',
            title: 'bad type',
            message: '確認してください',
            link: null,
            is_read: false,
            created_at: '2026-05-31T00:00:00.000Z',
          },
          {
            id: 'notification_2',
            type: 'business',
            title: '業務通知',
            message: '確認してください',
            link: null,
            is_read: false,
            created_at: '2026-05-31T00:01:00.000Z',
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'notification_2',
        type: 'business',
        title: '業務通知',
        message: '確認してください',
        link: null,
        is_read: false,
        created_at: '2026-05-31T00:01:00.000Z',
      },
    ]);
  });
});

describe('normalizeNotificationStreamPayload', () => {
  it('normalizes already-parsed notification arrays from the shared realtime stream', () => {
    expect(
      normalizeNotificationStreamPayload([
        {
          id: 'notification_3',
          type: 'system',
          title: 'システム通知',
          message: '反映しました',
          link: '/settings',
          is_read: true,
          created_at: '2026-05-31T00:02:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'notification_3',
        type: 'system',
        title: 'システム通知',
        message: '反映しました',
        link: '/settings',
        is_read: true,
        created_at: '2026-05-31T00:02:00.000Z',
      },
    ]);
  });
});
