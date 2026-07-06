import { describe, expect, it } from 'vitest';
import {
  buildPatientMovementTimelineEvents,
  toPatientMovementTimelineEvent,
} from './patient-movement-timeline-presenter';
import type { TimelineEvent } from './patient-detail-timeline-events';

function baseEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'operation_history:event_1',
    event_type: 'operation_history',
    category: 'document',
    occurred_at: new Date('2026-07-07T01:00:00.000Z'),
    title: '患者操作履歴を記録',
    summary: null,
    href: '/patients/patient_1',
    action_label: '患者詳細を開く',
    status: 'created',
    status_label: '作成済み',
    actor_name: '佐藤 薬剤師',
    metadata: [],
    ...overrides,
  };
}

describe('patient-movement-timeline-presenter', () => {
  it('projects prescription events as occurrence-only cards with detail links', () => {
    const movement = toPatientMovementTimelineEvent(
      baseEvent({
        id: 'prescription_intake:intake_1',
        event_type: 'prescription_intake',
        category: 'prescription',
        title: '処方受付を登録',
        summary: 'FAX / 主治医 山田 / カロナール500mg 10錠 / 湿布70枚',
        href: '/prescriptions/intake_1',
        action_label: '処方受付を開く',
        status: 'audit_pending',
        status_label: '監査待ち',
        metadata: ['2剤まで表示', '薬剤名 カロナール'],
      }),
      { patientId: 'patient_1' },
    );

    expect(movement).toMatchObject({
      id: 'prescription_intake:intake_1',
      event_type: 'prescription_event',
      category: 'prescription',
      title: '処方受付を登録',
      summary: '処方登録または処方変更がありました。内容は処方詳細で確認してください。',
      href: '/prescriptions/intake_1',
      action_label: '処方受付を開く',
      status: 'audit_pending',
      status_label: '監査待ち',
      related_entity_type: 'prescription_intake',
      related_entity_id: 'intake_1',
      privacy_level: 'summary',
      raw_available: false,
      metadata: [],
    });
    expect(movement).not.toHaveProperty('event_detail_href');
    expect(JSON.stringify(movement)).not.toContain('カロナール');
    expect(JSON.stringify(movement)).not.toContain('湿布70枚');
  });

  it('projects visit and document events without leaking record bodies or file names', () => {
    const movementEvents = buildPatientMovementTimelineEvents(
      [
        baseEvent({
          id: 'visit_record:visit_1',
          event_type: 'visit_record',
          category: 'visit',
          title: '訪問記録を保存',
          summary: 'SOAP: 退院後の服薬支援本文 / 残薬確認本文',
          href: '/visits/visit_1',
          action_label: '訪問記録を開く',
          metadata: ['SOAP本文あり'],
        }),
        baseEvent({
          id: 'first_visit_document:doc_1',
          event_type: 'first_visit_document',
          category: 'document',
          title: '契約書を作成',
          summary: '契約書 patient-name-yamada.pdf / 重要事項説明本文',
          href: 'https://storage.example.com/private/patient-name-yamada.pdf',
          action_label: 'PDFを見る',
          metadata: ['patient-name-yamada.pdf'],
        }),
      ],
      { patientId: 'patient_1' },
    );

    expect(movementEvents[0]).toMatchObject({
      event_type: 'visit_event',
      category: 'visit',
      summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
      href: '/visits/visit_1',
      metadata: [],
    });
    expect(movementEvents[1]).toMatchObject({
      event_type: 'document_registered',
      category: 'document',
      summary: '文書登録または文書状態の更新がありました。本文は詳細画面で確認してください。',
      href: '/patients/patient_1#patient-movement',
      metadata: [],
    });
    expect(movementEvents[0]).not.toHaveProperty('event_detail_href');
    expect(movementEvents[1]).not.toHaveProperty('event_detail_href');

    const serialized = JSON.stringify(movementEvents);
    expect(serialized).not.toContain('退院後の服薬支援本文');
    expect(serialized).not.toContain('重要事項説明本文');
    expect(serialized).not.toContain('patient-name-yamada.pdf');
    expect(serialized).not.toContain('storage.example.com');
  });

  it('normalizes prescription and document operation history as marker events', () => {
    const movementEvents = buildPatientMovementTimelineEvents(
      [
        baseEvent({
          id: 'operation_history:audit_rx_1',
          event_type: 'operation_history',
          category: 'prescription',
          title: '処方せん画像/PDFを保存',
          summary: '処方せん画像 filename-yamada-rx.pdf / EP-12345 / カロナール500mg',
          href: '/prescriptions/intake_1',
          action_label: '処方受付を開く',
          metadata: ['filename-yamada-rx.pdf', 'EP-12345'],
        }),
        baseEvent({
          id: 'operation_history:audit_doc_1',
          event_type: 'operation_history',
          category: 'document',
          title: '服薬カレンダーPDFを出力',
          summary: '服薬カレンダー本文 / calendar-yamada.pdf',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書を開く',
          metadata: ['calendar-yamada.pdf'],
        }),
      ],
      { patientId: 'patient_1' },
    );

    expect(movementEvents).toEqual([
      expect.objectContaining({
        id: 'operation_history:audit_rx_1',
        event_type: 'prescription_event',
        category: 'prescription',
        summary: '処方登録または処方変更がありました。内容は処方詳細で確認してください。',
        href: '/prescriptions/intake_1',
        metadata: [],
      }),
      expect.objectContaining({
        id: 'operation_history:audit_doc_1',
        event_type: 'document_registered',
        category: 'document',
        summary: '文書登録または文書状態の更新がありました。本文は詳細画面で確認してください。',
        href: '/patients/patient_1#patient-documents',
        metadata: [],
      }),
    ]);

    const serialized = JSON.stringify(movementEvents);
    expect(serialized).not.toContain('filename-yamada-rx.pdf');
    expect(serialized).not.toContain('calendar-yamada.pdf');
    expect(serialized).not.toContain('EP-12345');
    expect(serialized).not.toContain('カロナール500mg');
    expect(serialized).not.toContain('服薬カレンダー本文');
  });
});
