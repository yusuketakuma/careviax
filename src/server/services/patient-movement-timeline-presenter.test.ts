import { describe, expect, it } from 'vitest';
import {
  buildPatientMovementTimelineEvents,
  toPatientMovementTimelineEvent,
} from './patient-movement-timeline-presenter';
import type { TimelineEvent } from './patient-detail-timeline-events';
import type {
  PatientMovementCategory,
  PatientMovementEventType,
} from '@/types/patient-movement-timeline';

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
      event_type: 'prescription_intake',
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
      event_type: 'visit_record',
      category: 'visit',
      summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
      href: '/visits/visit_1',
      metadata: [],
    });
    expect(movementEvents[1]).toMatchObject({
      event_type: 'first_visit_document',
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

  it('projects medication stock snapshot markers without raw stock details', () => {
    const movement = toPatientMovementTimelineEvent(
      baseEvent({
        id: 'medication_stock_snapshot:snapshot_1',
        event_type: 'medication_stock_snapshot',
        category: 'medication_stock',
        title: '残数不足リスクを検出',
        summary: 'カロナール500mg 10錠 / stock_item_1 / 不足理由 raw_reason',
        href: '/patients/patient_1#card-prescription-section',
        action_label: '残数を確認',
        status: 'urgent',
        status_label: '至急',
        metadata: ['stock_item_1', '薬剤名 カロナール', '数量 10錠', '理由 raw_reason'],
      }),
      { patientId: 'patient_1' },
    );

    expect(movement).toMatchObject({
      id: 'medication_stock_snapshot:snapshot_1',
      event_type: 'medication_stock_snapshot',
      category: 'medication_stock',
      title: '残数不足リスクを検出',
      summary: '現在の残数予測で不足リスクがあります。内容は薬剤・訪問で確認してください。',
      href: '/patients/patient_1#card-prescription-section',
      action_label: '残数を確認',
      status: 'urgent',
      status_label: '至急',
      related_entity_type: 'medication_stock_snapshot',
      related_entity_id: 'snapshot_1',
      severity: 'urgent',
      badges: [{ label: '至急', tone: 'warning' }],
      metadata: [],
      privacy_level: 'summary',
      raw_available: false,
    });

    const serialized = JSON.stringify(movement);
    expect(serialized).not.toContain('カロナール');
    expect(serialized).not.toContain('10錠');
    expect(serialized).not.toContain('stock_item_1');
    expect(serialized).not.toContain('raw_reason');
  });

  const sourceParityCases: Array<{
    label: string;
    source: Partial<TimelineEvent>;
    expected: {
      event_type: PatientMovementEventType;
      category: PatientMovementCategory;
      href: string;
      action_label: string;
    };
    hidden?: string[];
  }> = [
    {
      label: 'visit schedule',
      source: {
        id: 'visit_schedule:schedule_1',
        event_type: 'visit_schedule',
        category: 'visit',
        title: '訪問予定を登録',
        summary: 'SOAP本文 / 訪問メモ',
        href: '/visits/schedule_1/record',
        action_label: '訪問記録を入力',
        metadata: ['SOAP本文'],
      },
      expected: {
        event_type: 'visit_schedule',
        category: 'visit',
        href: '/visits/schedule_1/record',
        action_label: '訪問記録を入力',
      },
      hidden: ['SOAP本文', '訪問メモ'],
    },
    {
      label: 'visit record',
      source: {
        id: 'visit_record:visit_1',
        event_type: 'visit_record',
        category: 'visit',
        title: '訪問記録を登録',
        summary: '退院後の服薬支援本文',
        href: '/visits/visit_1',
        action_label: '訪問記録を開く',
        metadata: ['残薬確認本文'],
      },
      expected: {
        event_type: 'visit_record',
        category: 'visit',
        href: '/visits/visit_1',
        action_label: '訪問記録を開く',
      },
      hidden: ['退院後の服薬支援本文', '残薬確認本文'],
    },
    {
      label: 'prescription intake',
      source: {
        id: 'prescription_intake:intake_1',
        event_type: 'prescription_intake',
        category: 'prescription',
        title: '処方受付を登録',
        summary: '薬剤名X 30錠 / 処方せん画像',
        href: '/prescriptions/intake_1',
        action_label: '処方受付を開く',
        metadata: ['薬剤名X 30錠'],
      },
      expected: {
        event_type: 'prescription_intake',
        category: 'prescription',
        href: '/prescriptions/intake_1',
        action_label: '処方受付を開く',
      },
      hidden: ['薬剤名X', '30錠', '処方せん画像'],
    },
    {
      label: 'dispense result',
      source: {
        id: 'dispense_result:dispense_1',
        event_type: 'dispense_result',
        category: 'prescription',
        title: '調剤を記録',
        summary: '調剤明細全文',
        href: '/prescriptions/intake_1',
        action_label: '処方記録を開く',
        metadata: ['明細 drug detail'],
      },
      expected: {
        event_type: 'dispense_result',
        category: 'prescription',
        href: '/prescriptions/intake_1',
        action_label: '処方記録を開く',
      },
      hidden: ['調剤明細全文', 'drug detail'],
    },
    {
      label: 'inquiry',
      source: {
        id: 'inquiry:inquiry_1',
        event_type: 'inquiry',
        category: 'prescription',
        title: '疑義照会 変更あり',
        summary: '疑義照会本文',
        href: '/prescriptions/intake_1',
        action_label: '処方受付を開く',
        metadata: ['照会本文'],
      },
      expected: {
        event_type: 'inquiry',
        category: 'prescription',
        href: '/prescriptions/intake_1',
        action_label: '処方受付を開く',
      },
      hidden: ['疑義照会本文', '照会本文'],
    },
    {
      label: 'care report',
      source: {
        id: 'care_report:report_1',
        event_type: 'care_report',
        category: 'document',
        title: '報告書を作成',
        summary: '報告書本文',
        href: '/reports/report_1',
        action_label: '報告書を開く',
        metadata: ['報告本文'],
      },
      expected: {
        event_type: 'care_report',
        category: 'document',
        href: '/reports/report_1',
        action_label: '報告書を開く',
      },
      hidden: ['報告書本文', '報告本文'],
    },
    {
      label: 'delivery record',
      source: {
        id: 'delivery_record:delivery_1',
        event_type: 'delivery_record',
        category: 'document',
        title: '報告書を送付',
        summary: '送付本文',
        href: '/reports/report_1',
        action_label: '送付元報告書を開く',
        metadata: ['送付先本文'],
      },
      expected: {
        event_type: 'delivery_record',
        category: 'document',
        href: '/reports/report_1',
        action_label: '送付元報告書を開く',
      },
      hidden: ['送付本文', '送付先本文'],
    },
    {
      label: 'management plan',
      source: {
        id: 'management_plan:plan_1',
        event_type: 'management_plan',
        category: 'document',
        title: '管理計画書を承認',
        summary: '管理計画書本文',
        href: '/patients/patient_1/management-plan',
        action_label: '計画書を開く',
        metadata: ['計画本文'],
      },
      expected: {
        event_type: 'management_plan',
        category: 'document',
        href: '/patients/patient_1/management-plan',
        action_label: '計画書を開く',
      },
      hidden: ['管理計画書本文', '計画本文'],
    },
    {
      label: 'first visit document',
      source: {
        id: 'first_visit_document:doc_1',
        event_type: 'first_visit_document',
        category: 'document',
        title: '初回訪問文書を作成',
        summary: '契約書本文',
        href: '/patients/patient_1#patient-documents',
        action_label: '文書状態を開く',
        metadata: ['契約書ファイル名'],
      },
      expected: {
        event_type: 'first_visit_document',
        category: 'document',
        href: '/patients/patient_1#patient-documents',
        action_label: '文書状態を開く',
      },
      hidden: ['契約書本文', '契約書ファイル名'],
    },
    {
      label: 'inbound phone',
      source: {
        id: 'communication:phone_1',
        event_type: 'inbound_phone',
        category: 'interprofessional',
        title: '電話連絡を受信',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
      expected: {
        event_type: 'inbound_phone',
        category: 'interprofessional',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
    },
    {
      label: 'inbound fax',
      source: {
        id: 'communication:fax_1',
        event_type: 'inbound_fax',
        category: 'interprofessional',
        title: 'FAX連絡を受信',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
      expected: {
        event_type: 'inbound_fax',
        category: 'interprofessional',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
    },
    {
      label: 'inbound email',
      source: {
        id: 'communication:email_1',
        event_type: 'inbound_email',
        category: 'interprofessional',
        title: 'メール連絡を受信',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
      expected: {
        event_type: 'inbound_email',
        category: 'interprofessional',
        href: '/conferences?patient_id=patient_1',
        action_label: '連絡履歴を開く',
      },
    },
    {
      label: 'inbound mcs',
      source: {
        id: 'patient_mcs_message:mcs_1',
        event_type: 'inbound_mcs',
        category: 'interprofessional',
        title: 'MCS投稿を受信',
        href: '/patients/patient_1/mcs',
        action_label: 'MCS連携を開く',
      },
      expected: {
        event_type: 'inbound_mcs',
        category: 'interprofessional',
        href: '/patients/patient_1/mcs',
        action_label: 'MCS連携を開く',
      },
    },
    {
      label: 'inbound task',
      source: {
        id: 'task:inbound_1',
        event_type: 'inbound_communication',
        category: 'interprofessional',
        title: '他職種受信確認タスクを作成',
        href: '/tasks?task_type=core.inbound_communication_review_required',
        action_label: 'タスクを開く',
      },
      expected: {
        event_type: 'inbound_communication',
        category: 'interprofessional',
        href: '/tasks?task_type=core.inbound_communication_review_required',
        action_label: 'タスクを開く',
      },
    },
    {
      label: 'stock event',
      source: {
        id: 'residual_medication:visit_1',
        event_type: 'medication_stock_event',
        category: 'medication_stock',
        title: '残薬確認を記録',
        href: '/visits/visit_1',
        action_label: '訪問記録を開く',
      },
      expected: {
        event_type: 'medication_stock_event',
        category: 'medication_stock',
        href: '/visits/visit_1',
        action_label: '訪問記録を開く',
      },
    },
    {
      label: 'stock snapshot',
      source: {
        id: 'medication_stock_snapshot:snapshot_1',
        event_type: 'medication_stock_snapshot',
        category: 'medication_stock',
        title: '残数不足リスクを検出',
        href: '/patients/patient_1#card-prescription-section',
        action_label: '残数を確認',
      },
      expected: {
        event_type: 'medication_stock_snapshot',
        category: 'medication_stock',
        href: '/patients/patient_1#card-prescription-section',
        action_label: '残数を確認',
      },
    },
    {
      label: 'stock signal task',
      source: {
        id: 'task:stock_1',
        event_type: 'inbound_medication_stock_signal',
        category: 'medication_stock',
        title: '残数確認タスクを作成',
        href: '/tasks?task_type=pharmacy.medication_stock_external_observation_review_required',
        action_label: 'タスクを開く',
      },
      expected: {
        event_type: 'inbound_medication_stock_signal',
        category: 'medication_stock',
        href: '/tasks?task_type=pharmacy.medication_stock_external_observation_review_required',
        action_label: 'タスクを開く',
      },
    },
    {
      label: 'generic task',
      source: {
        id: 'task:task_1',
        event_type: 'task_created',
        category: 'task',
        title: '運用タスクを作成',
        href: '/tasks?task_type=patient_self_report_followup',
        action_label: 'タスクを開く',
      },
      expected: {
        event_type: 'task_created',
        category: 'task',
        href: '/tasks?task_type=patient_self_report_followup',
        action_label: 'タスクを開く',
      },
    },
    {
      label: 'resolved task',
      source: {
        id: 'task:task_2',
        event_type: 'task_resolved',
        category: 'task',
        title: '運用タスクを完了',
        href: '/tasks?task_type=patient_self_report_followup&status=completed',
        action_label: 'タスクを開く',
      },
      expected: {
        event_type: 'task_resolved',
        category: 'task',
        href: '/tasks?task_type=patient_self_report_followup&status=completed',
        action_label: 'タスクを開く',
      },
    },
    {
      label: 'safety signal',
      source: {
        id: 'task:safety_1',
        event_type: 'safety_signal',
        category: 'safety',
        title: '安全確認タスクを作成',
        href: '/tasks?task_type=pharmacy.inbound_medication_safety_review_required',
        action_label: 'タスクを開く',
      },
      expected: {
        event_type: 'safety_signal',
        category: 'safety',
        href: '/tasks?task_type=pharmacy.inbound_medication_safety_review_required',
        action_label: 'タスクを開く',
      },
    },
  ];

  it.each(sourceParityCases)(
    'preserves movement source parity for $label',
    ({ source, expected, hidden = [] }) => {
      const movement = toPatientMovementTimelineEvent(baseEvent(source), {
        patientId: 'patient_1',
      });

      expect(movement).toMatchObject(expected);
      expect([movement.event_type]).not.toEqual(
        expect.arrayContaining(['visit_event', 'prescription_event', 'document_registered']),
      );

      const serialized = JSON.stringify(movement);
      for (const value of hidden) {
        expect(serialized).not.toContain(value);
      }
    },
  );
});
