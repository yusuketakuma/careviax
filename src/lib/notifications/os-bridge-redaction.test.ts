import { describe, expect, it } from 'vitest';

import { redactNotificationForOsBridge, redactPushPayloadForOsBridge } from './os-bridge-redaction';

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

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('太郎');
    expect(serialized).not.toContain('P-00421');
    expect(serialized).not.toContain('8f3a-2b91');
    expect(serialized).not.toContain('/prescriptions/');
  });

  it('緊急通知は種別ベースの汎用文言へ置き換える', () => {
    const redacted = redactNotificationForOsBridge(patientNotification);

    expect(redacted.title).toBe('PH-OS 通知');
    expect(redacted.body).toBe('新しい緊急通知があります');
    expect(redacted.url).toBe('/notifications');
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
    expect(redacted.body).toBe('新しい通知があります');
    expect(redacted.url).toBe('/notifications');
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
      title: 'PH-OS 通知',
      body: '新しい緊急通知があります',
      url: '/notifications',
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('太郎');
    expect(serialized).not.toContain('P-00421');
    expect(serialized).not.toContain('8f3a-2b91');
    expect(serialized).not.toContain('/patients/');
    expect(serialized).not.toContain('report_1');
    expect(serialized).not.toContain('visit_1');
  });

  it('Web Push payload が壊れていても system 汎用文言へ丸める', () => {
    expect(redactPushPayloadForOsBridge('raw patient body')).toEqual({
      title: 'PH-OS 通知',
      body: '新しいシステム通知があります',
      url: '/notifications',
    });
  });
});
