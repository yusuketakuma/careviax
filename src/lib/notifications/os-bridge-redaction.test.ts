import { describe, expect, it } from 'vitest';

import {
  getOsBridgeNotificationTag,
  normalizeOsBridgeNotificationType,
  redactNotificationForOsBridge,
  redactPushPayloadForOsBridge,
} from './os-bridge-redaction';

const forbiddenOsNotificationTokens = [
  '山田',
  '太郎',
  '田中',
  '一郎',
  'P-00421',
  'ワルファリン',
  'モルヒネ',
  '肺がん',
  'patient_1',
  'report_1',
  'visit_1',
  'rx_1',
  '/patients/',
  '/prescriptions/',
  'provider_error',
  'metadata',
  'token=secret',
  'secret-token',
  'signed-url',
];

function expectNoOsPhi(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const token of forbiddenOsNotificationTokens) {
    expect(serialized).not.toContain(token);
  }
}

describe('redactNotificationForOsBridge', () => {
  // PHI を含む代表的な in-app 通知(患者名・処方内容・患者 ID 付きリンク)。
  const patientNotification = {
    id: 'ntf-1',
    type: 'urgent',
    title: '山田 太郎さんの緊急連絡',
    message: '山田 太郎さん(患者番号 P-00421)の処方に疑義があります',
    link: '/patients/8f3a-2b91/prescriptions/1234',
  };

  it('OS 層へ渡す文言に患者名・本文・ディープリンクを含めない', () => {
    const redacted = redactNotificationForOsBridge(patientNotification);

    expectNoOsPhi(redacted);
    expect(JSON.stringify(redacted)).not.toContain('8f3a-2b91');
  });

  it('緊急通知は種別ベースの汎用文言へ置き換える', () => {
    const redacted = redactNotificationForOsBridge(patientNotification);

    expect(redacted.title).toBe('PH-OS 通知');
    expect(redacted.body).toBe('新しい緊急通知があります');
    expect(redacted.url).toBe('/notifications');
    expect(redacted.type).toBe('urgent');
    expect(redacted.tag).toBe('ph-os-urgent-notification');
  });

  it('種別ごとに汎用本文を出し分ける', () => {
    expect(redactNotificationForOsBridge({ type: 'business' }).body).toBe(
      '新しい業務通知があります',
    );
    expect(redactNotificationForOsBridge({ type: 'reminder' }).body).toBe(
      '新しいリマインダーがあります',
    );
    expect(redactNotificationForOsBridge({ type: 'system' }).body).toBe(
      '新しいシステム通知があります',
    );
  });

  it('未知の種別でも汎用本文へフォールバックする(fail-close)', () => {
    const redacted = redactNotificationForOsBridge({ type: 'something-new' });

    expect(redacted.title).toBe('PH-OS 通知');
    expect(redacted.type).toBe('system');
    expect(redacted.body).toBe('新しいシステム通知があります');
    expect(redacted.url).toBe('/notifications');
    expect(redacted.tag).toBe('ph-os-system-notification');
  });

  it('OS 層へ渡す type と tag を allowlist に固定する', () => {
    expect(normalizeOsBridgeNotificationType('urgent')).toBe('urgent');
    expect(normalizeOsBridgeNotificationType('patient_specific_type')).toBe('system');
    expect(normalizeOsBridgeNotificationType({ type: 'urgent' })).toBe('system');
    expect(getOsBridgeNotificationTag('business')).toBe('ph-os-business-notification');
  });

  it('Web Push payload の raw title/body/link/ID を OS 層へ渡さない', () => {
    const redacted = redactPushPayloadForOsBridge({
      type: 'urgent',
      title: '山田 太郎さんの緊急連絡',
      body: '山田 太郎さん(患者番号 P-00421)の処方に疑義があります',
      link: '/patients/8f3a-2b91/prescriptions/1234',
      patientId: '8f3a-2b91',
      reportId: 'report_1',
      visitId: 'visit_1',
    });

    expect(redacted).toEqual({
      type: 'urgent',
      title: 'PH-OS 通知',
      body: '新しい緊急通知があります',
      url: '/notifications',
      tag: 'ph-os-urgent-notification',
    });

    expectNoOsPhi(redacted);
    expect(JSON.stringify(redacted)).not.toContain('8f3a-2b91');
  });

  it('Web Push payload が壊れていても system 汎用文言へ丸める', () => {
    expect(redactPushPayloadForOsBridge('raw patient body')).toEqual({
      type: 'system',
      title: 'PH-OS 通知',
      body: '新しいシステム通知があります',
      url: '/notifications',
      tag: 'ph-os-system-notification',
    });
  });

  it.each([
    [
      'notification_type alias',
      {
        notification_type: 'reminder',
        title: '山田 太郎さんの疑義照会',
        body: 'ワルファリンの残薬確認',
        link: '/patients/patient_1/prescriptions/rx_1',
      },
      {
        type: 'reminder',
        body: '新しいリマインダーがあります',
        tag: 'ph-os-reminder-notification',
      },
    ],
    [
      'nested raw fields',
      {
        type: 'business',
        data: {
          patientName: '山田 太郎',
          drugName: 'ワルファリン',
          provider_error: 'token=secret',
          storage_key: 'signed-url',
        },
      },
      {
        type: 'business',
        body: '新しい業務通知があります',
        tag: 'ph-os-business-notification',
      },
    ],
    [
      'unknown future type',
      {
        type: 'unknown_future_type',
        title: '田中 一郎',
        link: 'https://example.test/patients/patient_1?token=secret-token',
      },
      {
        type: 'system',
        body: '新しいシステム通知があります',
        tag: 'ph-os-system-notification',
      },
    ],
    [
      'null payload',
      null,
      {
        type: 'system',
        body: '新しいシステム通知があります',
        tag: 'ph-os-system-notification',
      },
    ],
    [
      'array payload',
      ['山田 太郎', '/patients/patient_1'],
      {
        type: 'system',
        body: '新しいシステム通知があります',
        tag: 'ph-os-system-notification',
      },
    ],
  ])('Web Push payload を fail-close で丸める: %s', (_label, payload, expected) => {
    const redacted = redactPushPayloadForOsBridge(payload);

    expect(redacted).toEqual({
      type: expected.type,
      title: 'PH-OS 通知',
      body: expected.body,
      url: '/notifications',
      tag: expected.tag,
    });
    expectNoOsPhi(redacted);
  });
});
