import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationStreamItem,
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

  it('keeps only allowlisted stream fields and drops hostile raw payload fields', () => {
    const normalized = normalizeNotificationStreamPayload([
      {
        id: 'notification_4',
        type: 'urgent',
        title: '田中 一郎さんの対応依頼',
        message: 'モルヒネ残薬を確認してください',
        link: '/notifications?tab=unread',
        is_read: false,
        created_at: new Date('2026-05-31T00:03:00.000Z'),
        patient_name: '山田花子',
        address: '東京都千代田区丸の内1-1-1',
        phone: '090-1234-5678',
        drug_name: 'モルヒネ硫酸塩徐放錠10mg',
        raw_message: '患者 山田花子 090-1234-5678',
        metadata: { token: 'raw-token-secret' },
        provider_error: 'storage_key=org_1/patients/patient_1/reports/report_1.pdf',
        token: 'raw-token-secret',
        storage_key: 'org_1/patients/patient_1/reports/report_1.pdf',
        signed_url: 'https://s3.example.test/file?X-Amz-Signature=secret',
      },
    ]);

    expect(normalized).toEqual([
      {
        id: 'notification_4',
        type: 'urgent',
        title: '田中 一郎さんの対応依頼',
        message: 'モルヒネ残薬を確認してください',
        link: '/notifications?tab=unread',
        is_read: false,
        created_at: '2026-05-31T00:03:00.000Z',
      },
    ]);
    const serialized = JSON.stringify(normalized);
    for (const forbidden of [
      '山田花子',
      '東京都千代田区',
      '090-1234-5678',
      '硫酸塩徐放錠',
      'raw_message',
      'metadata',
      'provider_error',
      'raw-token-secret',
      'storage_key',
      'signed_url',
      'X-Amz-Signature',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects malformed rows and unsafe notification links', () => {
    const valid = {
      id: 'notification_5',
      type: 'system',
      title: 'システム通知',
      message: '確認してください',
      link: '/notifications',
      is_read: false,
      created_at: '2026-05-31T00:04:00.000Z',
    };

    expect(
      normalizeNotificationStreamPayload([valid, { ...valid, link: 'https://example.test' }]),
    ).toEqual([valid]);
    expect(normalizeNotificationStreamPayload([{ ...valid, link: '//example.test' }])).toEqual([]);
    expect(normalizeNotificationStreamPayload([{ ...valid, link: 'javascript:alert(1)' }])).toEqual(
      [],
    );
    expect(normalizeNotificationStreamPayload([{ ...valid, created_at: 'not-a-date' }])).toEqual(
      [],
    );
    expect(normalizeNotificationStreamItem({ ...valid, type: 'visit' })).toBeNull();
  });
});
