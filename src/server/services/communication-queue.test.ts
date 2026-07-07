import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selfReportFindManyMock,
  contactLogFindManyMock,
  communicationRequestFindManyMock,
  inboundCommunicationEventFindManyMock,
  inboundCommunicationSignalFindManyMock,
  deliveryRecordFindManyMock,
  externalAccessGrantFindManyMock,
  careReportFindManyMock,
  tracingReportFindManyMock,
  patientFindFirstMock,
  patientFindManyMock,
  medicationIssueFindManyMock,
  taskFindManyMock,
} = vi.hoisted(() => ({
  selfReportFindManyMock: vi.fn(),
  contactLogFindManyMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  inboundCommunicationEventFindManyMock: vi.fn(),
  inboundCommunicationSignalFindManyMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  tracingReportFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/utils/date', () => ({
  isoOrNull: (v: Date | null | undefined) => (v ? v.toISOString() : null),
}));

import { listCommunicationQueue } from './communication-queue';

function makeDb() {
  return {
    patientSelfReport: { findMany: selfReportFindManyMock },
    visitScheduleContactLog: { findMany: contactLogFindManyMock },
    communicationRequest: { findMany: communicationRequestFindManyMock },
    inboundCommunicationEvent: { findMany: inboundCommunicationEventFindManyMock },
    inboundCommunicationSignal: { findMany: inboundCommunicationSignalFindManyMock },
    deliveryRecord: { findMany: deliveryRecordFindManyMock },
    externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
    careReport: { findMany: careReportFindManyMock },
    tracingReport: { findMany: tracingReportFindManyMock },
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    medicationIssue: { findMany: medicationIssueFindManyMock },
    task: { findMany: taskFindManyMock },
  };
}

function emptyDbMocks() {
  selfReportFindManyMock.mockResolvedValue([]);
  contactLogFindManyMock.mockResolvedValue([]);
  communicationRequestFindManyMock.mockResolvedValue([]);
  inboundCommunicationEventFindManyMock.mockResolvedValue([]);
  inboundCommunicationSignalFindManyMock.mockResolvedValue([]);
  deliveryRecordFindManyMock.mockResolvedValue([]);
  externalAccessGrantFindManyMock.mockResolvedValue([]);
  careReportFindManyMock.mockResolvedValue([]);
  tracingReportFindManyMock.mockResolvedValue([]);
  patientFindFirstMock.mockResolvedValue(null);
  patientFindManyMock.mockResolvedValue([]);
  medicationIssueFindManyMock.mockResolvedValue([]);
  taskFindManyMock.mockResolvedValue([]);
}

describe('listCommunicationQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty overview when no data exists', async () => {
    emptyDbMocks();

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.pending_count).toBe(0);
    expect(result.summary.inbound_communications).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.emergency_drafts).toEqual([]);
  });

  it('includes self reports as queue items', async () => {
    emptyDbMocks();
    selfReportFindManyMock.mockResolvedValue([
      {
        id: 'sr-1',
        patient_id: 'p-1',
        subject: '体調不良',
        category: 'symptom',
        requested_callback: true,
        preferred_contact_time: '午前中',
        reported_by_name: '家族A',
        status: 'submitted',
        created_at: new Date('2026-04-01T08:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.self_reports).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].queue_type).toBe('self_report');
    expect(result.items[0].priority).toBe('urgent'); // has callback
    expect(result.items[0].patient_name).toBe('田中太郎');
    expect(result.items[0].action_href).toBe('/external?focus=self_reports');
  });

  it('focuses callback queue items on the linked visit schedule', async () => {
    emptyDbMocks();
    const scheduleId = 'schedule/1?x=y#frag';
    contactLogFindManyMock.mockResolvedValue([
      {
        id: 'callback-1',
        patient_id: 'p-1',
        schedule_id: scheduleId,
        outcome: 'unreachable',
        contact_name: '家族A',
        contact_phone: '090-0000-0000',
        note: null,
        callback_due_at: new Date('2026-04-01T09:00:00Z'),
        called_at: new Date('2026-04-01T08:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(contactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ schedule_id: true }),
      }),
    );
    expect(result.summary.callback_followups).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        queue_type: 'callback',
        patient_name: '田中太郎',
        action_href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`,
      }),
    ]);
  });

  it('includes communication requests as queue items', async () => {
    emptyDbMocks();
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'cr-1',
        patient_id: 'p-1',
        request_type: 'care_report_reply_request',
        subject: '処方確認',
        content: '用量について確認',
        template_key: null,
        related_entity_type: 'care_report',
        related_entity_id: 'report-1',
        status: 'sent',
        due_date: new Date('2026-04-02'),
        requested_at: new Date('2026-04-01'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.open_requests).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        queue_type: 'request',
        summary: '多職種連携 報告書返信依頼',
        action_href:
          '/communications/requests?status=sent&request_type=care_report_reply_request&patient_id=p-1&request_id=cr-1&related_entity_type=care_report&related_entity_id=report-1',
      }),
    ]);
    expect(result.timeline).toEqual([
      expect.objectContaining({
        source_type: 'communication_request',
        summary: '報告書返信依頼 / 用量について確認',
        action_href:
          '/communications/requests?status=sent&request_type=care_report_reply_request&patient_id=p-1&request_id=cr-1&related_entity_type=care_report&related_entity_id=report-1',
      }),
    ]);
  });

  it('includes inbound communication events as summary-only queue items', async () => {
    emptyDbMocks();
    const patientId = 'patient/1?x=y#frag';
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event/1?x=y#frag',
        patient_id: patientId,
        case_id: 'case-1',
        event_type: 'medication_stock_report',
        source_channel: 'phone',
        received_at: new Date('2026-04-02T10:00:00Z'),
        subject: '湿布の残りが少ない',
        content: '湿布は残り4枚です',
        counterpart_name: '訪問看護師A',
        counterpart_contact: '090-0000-0000',
        attachments: [{ name: 'photo.jpg', storage_key: 'secret-key' }],
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: patientId, name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId,
      caseIds: ['case-1'],
    });

    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org-1',
          patient_id: patientId,
          source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
          AND: [{ OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }] }],
        }),
        select: {
          id: true,
          patient_id: true,
          source_channel: true,
          received_at: true,
        },
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org-1',
        task_type: {
          in: [
            'core.inbound_communication_review_required',
            'pharmacy.inbound_medication_stock_signal_review_required',
            'pharmacy.inbound_low_stock_unquantified_report',
            'pharmacy.inbound_medication_safety_review_required',
            'pharmacy.inbound_schedule_request_review_required',
          ],
        },
        OR: [
          {
            dedupe_key: {
              startsWith: 'inbound-signal-task:event/1?x=y#frag:',
            },
          },
        ],
      },
      select: {
        id: true,
        task_type: true,
        status: true,
        priority: true,
        dedupe_key: true,
      },
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event/1?x=y#frag',
        queue_type: 'inbound_communication',
        title: '電話連絡を受信',
        summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
        channel: 'phone',
        status: 'needs_review',
        priority: 'high',
        patient_id: patientId,
        patient_name: '佐藤花子',
        action_href: `/patients/${encodeURIComponent(patientId)}/collaboration`,
        action_label: '受信情報を確認',
      }),
    ]);
    expect(result.summary.pending_count).toBe(1);
    expect(result.summary.inbound_communications).toBe(1);

    const serialized = JSON.stringify(result.items);
    expect(serialized).not.toContain('case-1');
    expect(serialized).not.toContain('medication_stock_report');
    expect(serialized).not.toContain('"direction"');
    expect(serialized).not.toContain('湿布の残りが少ない');
    expect(serialized).not.toContain('湿布は残り4枚です');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('090-0000-0000');
    expect(serialized).not.toContain('photo.jpg');
    expect(serialized).not.toContain('secret-key');
  });

  it('marks inbound communication events as task-created when a deduped signal task exists', async () => {
    emptyDbMocks();
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: null,
        event_type: 'medication_stock_report',
        source_channel: 'phone',
        received_at: new Date('2026-04-02T10:00:00Z'),
        subject: '湿布の残りが少ない',
        content: '湿布は残り4枚です',
        counterpart_name: '訪問看護師A',
        counterpart_contact: '090-0000-0000',
        attachments: [{ name: 'photo.jpg', storage_key: 'secret-key' }],
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
        status: 'pending',
        priority: 'urgent',
        dedupe_key:
          'inbound-signal-task:event_1:0:pharmacy.inbound_medication_stock_signal_review_required',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      queueTypes: ['inbound_communication'],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event_1',
        status: 'task_created',
        priority: 'urgent',
        summary:
          '他職種受信から薬剤師確認タスクを作成済みです。タスク一覧で処理状況を確認してください。',
        action_href:
          '/tasks?status=&task_type=pharmacy.inbound_medication_stock_signal_review_required',
        action_label: 'タスクを確認',
      }),
    ]);

    const serialized = JSON.stringify(result.items);
    expect(serialized).not.toContain('湿布は残り4枚です');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('090-0000-0000');
    expect(serialized).not.toContain('photo.jpg');
    expect(serialized).not.toContain('secret-key');
  });

  it('marks inbound communication events as task-created from formal signal task dedupe keys', async () => {
    emptyDbMocks();
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        source_channel: 'phone',
        received_at: new Date('2026-04-02T10:00:00Z'),
      },
    ]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_1',
        inbound_event_id: 'event_1',
        review_status: 'needs_review',
        action_status: 'not_linked',
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
        status: 'pending',
        priority: 'urgent',
        dedupe_key: 'inbound:signal_1:pharmacy.inbound_medication_stock_signal_review_required',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      queueTypes: ['inbound_communication'],
    });

    expect(inboundCommunicationSignalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org-1',
        inbound_event_id: {
          in: ['event_1'],
        },
      },
      select: {
        id: true,
        inbound_event_id: true,
        review_status: true,
        action_status: true,
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org-1',
        task_type: {
          in: [
            'core.inbound_communication_review_required',
            'pharmacy.inbound_medication_stock_signal_review_required',
            'pharmacy.inbound_low_stock_unquantified_report',
            'pharmacy.inbound_medication_safety_review_required',
            'pharmacy.inbound_schedule_request_review_required',
          ],
        },
        OR: [
          {
            dedupe_key: {
              startsWith: 'inbound-signal-task:event_1:',
            },
          },
          {
            dedupe_key: {
              startsWith: 'inbound:signal_1:',
            },
          },
        ],
      },
      select: {
        id: true,
        task_type: true,
        status: true,
        priority: true,
        dedupe_key: true,
      },
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event_1',
        status: 'task_created',
        priority: 'urgent',
        action_href:
          '/tasks?status=&task_type=pharmacy.inbound_medication_stock_signal_review_required',
        action_label: 'タスクを確認',
      }),
    ]);
  });

  it('marks inbound communication events as completed when all formal signals are record-only or rejected', async () => {
    emptyDbMocks();
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        source_channel: 'phone',
        received_at: new Date('2026-04-02T10:00:00Z'),
      },
    ]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_1',
        inbound_event_id: 'event_1',
        review_status: 'record_only',
        action_status: 'ignored',
      },
      {
        id: 'signal_2',
        inbound_event_id: 'event_1',
        review_status: 'rejected',
        action_status: 'ignored',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      queueTypes: ['inbound_communication'],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event_1',
        status: 'task_completed',
        priority: 'normal',
        summary:
          '他職種受信シグナルはレビュー済みです。必要に応じて患者詳細で経緯を確認してください。',
      }),
    ]);
  });

  it('marks accepted formal signals as reviewed pending action until downstream reflection exists', async () => {
    emptyDbMocks();
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        patient_id: 'patient_1',
        source_channel: 'phone',
        received_at: new Date('2026-04-02T10:00:00Z'),
      },
    ]);
    inboundCommunicationSignalFindManyMock.mockResolvedValue([
      {
        id: 'signal_1',
        inbound_event_id: 'event_1',
        review_status: 'accepted',
        action_status: 'not_linked',
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
        status: 'completed',
        priority: 'normal',
        dedupe_key: 'inbound:signal_1:pharmacy.inbound_medication_stock_signal_review_required',
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      queueTypes: ['inbound_communication'],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event_1',
        status: 'reviewed_pending_action',
        priority: 'high',
        summary:
          '受信シグナルはレビュー済みです。残数台帳など業務データへの明示反映が残っています。',
        action_href: '/patients/patient_1/collaboration',
        action_label: '受信情報を確認',
      }),
    ]);
  });

  it('projects MCS inbound communication events as the public mcs channel without raw payload', async () => {
    emptyDbMocks();
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'mcs_event_1',
        patient_id: 'patient_1',
        case_id: null,
        event_type: 'medication_stock_report',
        source_channel: 'mcs',
        received_at: new Date('2026-04-02T10:00:00Z'),
        subject: 'MCS貼り付け: 残数報告',
        content: 'ロキソニンは残り4錠です。source_url=https://www.medical-care.net/projects/1',
        counterpart_name: '訪問看護師A',
        counterpart_contact: 'https://www.medical-care.net/projects/1',
        attachments: [{ name: 'mcs.png', storage_key: 'secret-key' }],
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:mcs_event_1',
        queue_type: 'inbound_communication',
        title: 'MCS連絡を受信',
        summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
        channel: 'mcs',
        action_href: '/patients/patient_1/collaboration',
      }),
    ]);
    expect(result.summary.inbound_communications).toBe(1);

    const serialized = JSON.stringify(result.items);
    expect(serialized).not.toContain('ロキソニン');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('medical-care.net');
    expect(serialized).not.toContain('secret-key');
  });

  it('applies queue type filtering before the final queue item limit', async () => {
    emptyDbMocks();
    selfReportFindManyMock.mockResolvedValue([
      {
        id: 'sr-1',
        patient_id: 'p-1',
        subject: '先に並ぶ自己申告',
        category: 'symptom',
        requested_callback: true,
        preferred_contact_time: null,
        reported_by_name: '家族A',
        status: 'submitted',
        created_at: new Date('2026-04-02T12:00:00Z'),
      },
    ]);
    inboundCommunicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event-1',
        patient_id: 'p-1',
        case_id: null,
        event_type: 'general_note',
        source_channel: 'phone',
        received_at: new Date('2026-04-01T10:00:00Z'),
        subject: '電話連絡',
        content: 'raw text is not selected',
        counterpart_name: '訪問看護師A',
        counterpart_contact: '090-0000-0000',
        attachments: [],
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      limit: 1,
      queueTypes: ['inbound_communication'],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'inbound_communication:event-1',
        queue_type: 'inbound_communication',
      }),
    ]);
    expect(result.summary.pending_count).toBe(1);
    expect(result.summary.inbound_communications).toBe(1);
    expect(result.summary.self_reports).toBe(1);
  });

  it('links tracing report timeline entries to related communication requests', async () => {
    emptyDbMocks();
    tracingReportFindManyMock.mockResolvedValue([
      {
        id: 'tracing/1?x=y#frag',
        patient_id: 'patient 1/../x?y=#frag',
        status: 'sent',
        sent_to_physician: '在宅主治医',
        sent_at: new Date('2026-04-02T10:00:00Z'),
        acknowledged_at: null,
        updated_at: new Date('2026-04-02T11:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient 1/../x?y=#frag', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.timeline).toEqual([
      expect.objectContaining({
        source_type: 'tracing_report',
        patient_name: '佐藤花子',
        action_href:
          '/communications/requests?patient_id=patient+1%2F..%2Fx%3Fy%3D%23frag&related_entity_type=tracing_report&related_entity_id=tracing%2F1%3Fx%3Dy%23frag',
        action_label: '関連依頼を確認',
      }),
    ]);
  });

  it('links report delivery queue and timeline entries to the exact report detail', async () => {
    emptyDbMocks();
    const reportId = 'report/1?x=y#frag';
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        id: 'delivery-1',
        channel: 'fax',
        recipient_name: '在宅主治医',
        status: 'failed',
        failure_reason: 'FAX送信に失敗しました',
        sent_at: new Date('2026-04-02T10:00:00Z'),
        confirmed_at: null,
        updated_at: new Date('2026-04-02T11:00:00Z'),
        report: {
          id: reportId,
          patient_id: 'p-1',
          report_type: 'physician_report',
        },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    const expectedHref = `/reports/${encodeURIComponent(reportId)}`;
    expect(result.items).toEqual([
      expect.objectContaining({
        queue_type: 'delivery',
        action_href: expectedHref,
      }),
    ]);
    expect(result.timeline).toEqual([
      expect.objectContaining({
        source_type: 'delivery_record',
        action_href: expectedHref,
      }),
    ]);
  });

  it('links care report timeline entries to the exact report detail', async () => {
    emptyDbMocks();
    const reportId = 'care-report/1?x=y#frag';
    careReportFindManyMock.mockResolvedValue([
      {
        id: reportId,
        patient_id: 'p-1',
        report_type: 'care_manager_report',
        status: 'sent',
        created_at: new Date('2026-04-01T10:00:00Z'),
        updated_at: new Date('2026-04-02T10:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.timeline).toEqual([
      expect.objectContaining({
        source_type: 'care_report',
        patient_name: '佐藤花子',
        action_href: `/reports/${encodeURIComponent(reportId)}`,
      }),
    ]);
  });

  it('scopes case-backed communication records when caseIds are provided', async () => {
    emptyDbMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '患者A',
      contacts: [],
    });

    await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseIds: ['case-1'],
      limit: 3,
    });

    const caseScope = {
      OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
    };
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
          source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
        }),
      }),
    );
    expect(contactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          case_id: { in: ['case-1'] },
        }),
      }),
    );
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          report: expect.objectContaining({
            patient_id: 'p-1',
            AND: [caseScope],
          }),
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
        }),
      }),
    );
  });

  it('applies bulk patientIds and caseIds to dashboard communication queue sources', async () => {
    emptyDbMocks();

    await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-1', 'p-2'],
      caseIds: ['case-1'],
      limit: 3,
    });

    const patientScope = { patient_id: { in: ['p-1', 'p-2'] } };
    const caseScope = {
      OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
    };
    expect(selfReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(patientScope),
      }),
    );
    expect(contactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          case_id: { in: ['case-1'] },
        }),
      }),
    );
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
          source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
        }),
      }),
    );
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          report: expect.objectContaining({
            ...patientScope,
            AND: [caseScope],
          }),
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case-1'] } },
              ]),
            }),
          ]),
        }),
        take: 3,
      }),
    );
  });

  it('builds emergency drafts when patientId is provided and patient has contacts', async () => {
    emptyDbMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '高橋一郎',
      contacts: [
        { name: '山田医師', relation: 'physician', is_emergency_contact: false },
        { name: '家族太郎', relation: 'spouse', is_emergency_contact: true },
      ],
    });
    medicationIssueFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result.emergency_drafts.length).toBeGreaterThan(0);
    const templateKeys = result.emergency_drafts.map((d) => d.template_key);
    expect(templateKeys).toContain('emergency_physician');
    expect(templateKeys).toContain('emergency_family');
  });

  it('suggests missing emergency contact draft when no emergency contacts exist', async () => {
    emptyDbMocks();
    const patientId = 'patient/1?x=y#frag';
    patientFindFirstMock.mockResolvedValue({
      id: patientId,
      name: '独居太郎',
      contacts: [],
    });
    medicationIssueFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId,
    });

    const gapDraft = result.emergency_drafts.find(
      (d) => d.template_key === 'missing_emergency_contact',
    );
    expect(gapDraft).toBeDefined();
    expect(gapDraft!.title).toContain('緊急連絡先');
    expect(gapDraft!.patient_id).toBe(patientId);
    expect(gapDraft!.action_href).toBe(
      `/patients/${encodeURIComponent(patientId)}/edit?section=visit#intake.emergency_contact.name`,
    );
  });

  it('limits items to requested limit', async () => {
    emptyDbMocks();
    selfReportFindManyMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `sr-${i}`,
        patient_id: `p-${i}`,
        subject: `件名${i}`,
        category: 'symptom',
        requested_callback: false,
        preferred_contact_time: null,
        reported_by_name: '報告者',
        status: 'submitted',
        created_at: new Date(),
      })),
    );
    patientFindManyMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `p-${i}`,
        name: `患者${i}`,
      })),
    );

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      limit: 2,
    });

    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('uses the default query limit when the supplied limit is %s', async (_label, limit) => {
    emptyDbMocks();

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      limit,
    });

    expect(result.items).toEqual([]);
    expect(selfReportFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
    expect(inboundCommunicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
  });

  it('filters external share visibility before applying the final queue item limit', async () => {
    emptyDbMocks();
    const patientId = 'patient 1/../x?y=#frag';
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'visible-1',
        patient_id: patientId,
        granted_to_name: '担当内',
        expires_at: new Date('2026-04-02T00:00:00Z'),
        scope: { care_reports: true, allowed_case_ids: ['case-1'] },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: patientId, name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-hidden', patientId],
      caseIds: ['case-1'],
      limit: 1,
    });

    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case-1'] } },
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(result.summary.expiring_external_shares).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'external_share:visible-1',
        patient_id: patientId,
        action_href: `/patients/${encodeURIComponent(patientId)}/share`,
      }),
    ]);
    expect(result.items[0].action_href).not.toContain(patientId);
  });

  it('queries DB-visible external shares without offset paging hidden grants', async () => {
    emptyDbMocks();
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'visible-db-filtered',
        patient_id: 'p-1',
        granted_to_name: '担当内',
        expires_at: new Date('2026-04-02T00:00:00Z'),
        scope: { care_reports: true, allowed_case_ids: ['case-1'] },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-hidden', 'p-1'],
      caseIds: ['case-1'],
      limit: 1,
    });

    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        take: 1,
        orderBy: [{ expires_at: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(result.summary.expiring_external_shares).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'external_share:visible-db-filtered',
        patient_id: 'p-1',
      }),
    ]);
  });
});
