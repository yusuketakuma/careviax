import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deliveryRecordFindManyMock, patientFindManyMock, upsertOperationalTaskMock } = vi.hoisted(
  () => ({
    deliveryRecordFindManyMock: vi.fn(),
    patientFindManyMock: vi.fn(),
    upsertOperationalTaskMock: vi.fn(),
  }),
);

vi.mock('@/lib/db/client', () => ({
  prisma: {
    deliveryRecord: {
      findMany: deliveryRecordFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import {
  getCareReportDeliveryAnalytics,
  queueOverdueReportResponseReminders,
} from './report-reminders';

describe('report-reminders service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates monthly, physician, channel, and overdue response-waiting analytics', async () => {
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        id: 'delivery_confirmed',
        channel: 'fax',
        recipient_name: '在宅主治医A',
        recipient_contact: '03-1111-2222',
        status: 'confirmed',
        sent_at: new Date('2026-03-10T09:00:00.000Z'),
        created_at: new Date('2026-03-10T08:00:00.000Z'),
        report: {
          id: 'report_1',
          patient_id: 'patient_1',
          report_type: 'physician_report',
          created_by: 'user_1',
        },
      },
      {
        id: 'delivery_waiting',
        channel: 'email',
        recipient_name: '在宅主治医A',
        recipient_contact: 'doctor@example.com',
        status: 'response_waiting',
        sent_at: new Date('2026-03-01T09:00:00.000Z'),
        created_at: new Date('2026-03-01T08:00:00.000Z'),
        report: {
          id: 'report_2',
          patient_id: 'patient_2',
          report_type: 'physician_report',
          created_by: 'user_2',
        },
      },
      {
        id: 'delivery_failed',
        channel: 'fax',
        recipient_name: '担当ケアマネ',
        recipient_contact: '03-9999-8888',
        status: 'failed',
        sent_at: null,
        created_at: new Date('2026-02-20T08:00:00.000Z'),
        report: {
          id: 'report_3',
          patient_id: 'patient_3',
          report_type: 'care_manager_report',
          created_by: 'user_3',
        },
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_1', name: '山田 太郎' },
      { id: 'patient_2', name: '佐藤 花子' },
      { id: 'patient_3', name: '鈴木 次郎' },
    ]);

    const result = await getCareReportDeliveryAnalytics('org_1', {
      overdueDays: 7,
      now: new Date('2026-03-12T00:00:00.000Z'),
    });

    expect(result.summary).toMatchObject({
      current_month: '2026-03',
      current_month_attempted_count: 2,
      current_month_success_rate: 100,
      current_month_confirmed_rate: 50,
      overdue_waiting_count: 1,
      overdue_threshold_days: 7,
    });
    expect(result.physician_breakdown).toEqual([
      expect.objectContaining({
        recipient_name: '在宅主治医A',
        total_count: 2,
        success_rate: 100,
      }),
    ]);
    expect(result.channel_breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'fax', total_count: 2, failed_count: 1 }),
        expect.objectContaining({ channel: 'email', total_count: 1, success_rate: 100 }),
      ]),
    );
    expect(result.overdue_waiting).toEqual([
      expect.objectContaining({
        id: 'delivery_waiting',
        patient_name: '佐藤 花子',
        report_type: 'physician_report',
        recipient_contact: 'd***@example.com',
        recipient_contact_masked: 'd***@example.com',
        days_waiting: 11,
      }),
    ]);
    expect(JSON.stringify(result.overdue_waiting)).not.toContain('doctor@example.com');
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          report: { org_id: 'org_1' },
        }),
      }),
    );
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: { in: ['patient_1', 'patient_2', 'patient_3'] },
        }),
      }),
    );
  });

  it('uses an injected scoped database client for analytics reads', async () => {
    const scopedDb = {
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      patient: {
        findMany: vi.fn(),
      },
    };

    await getCareReportDeliveryAnalytics(
      'org_1',
      {
        now: new Date('2026-03-12T00:00:00.000Z'),
      },
      scopedDb as never,
    );

    expect(scopedDb.deliveryRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          report: { org_id: 'org_1' },
        }),
      }),
    );
    expect(scopedDb.patient.findMany).not.toHaveBeenCalled();
    expect(deliveryRecordFindManyMock).not.toHaveBeenCalled();
  });

  it('creates deduplicated follow-up tasks for overdue response-waiting deliveries', async () => {
    const tx = {
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'delivery_waiting',
            channel: 'fax',
            recipient_name: '在宅主治医A',
            recipient_contact: '03-1111-2222',
            sent_at: new Date('2026-03-01T09:00:00.000Z'),
            report: {
              id: 'report_1',
              patient_id: 'patient_1',
              report_type: 'physician_report',
              created_by: 'user_1',
              created_at: new Date('2026-03-01T08:30:00.000Z'),
            },
          },
          {
            id: 'delivery_waiting_retry',
            channel: 'fax',
            recipient_name: '在宅主治医A',
            recipient_contact: '03-1111-2222',
            sent_at: new Date('2026-03-02T09:00:00.000Z'),
            report: {
              id: 'report_1_retry',
              patient_id: 'patient_1',
              report_type: 'physician_report',
              created_by: 'user_1',
              created_at: new Date('2026-03-02T08:30:00.000Z'),
            },
          },
        ]),
      },
      task: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
    } as const;

    const result = await queueOverdueReportResponseReminders(tx, 'org_1', {
      overdueDays: 7,
      now: new Date('2026-03-12T00:00:00.000Z'),
    });

    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'report_response_followup',
        dedupeKey: expect.stringMatching(
          /^report-response-followup:patient_1:2026-03:[a-f0-9]{16}$/,
        ),
        relatedEntityType: 'care_report',
        relatedEntityId: 'report_1',
        metadata: expect.objectContaining({
          delivery_record_id: 'delivery_waiting',
          delivery_record_ids: ['delivery_waiting', 'delivery_waiting_retry'],
          report_ids: ['report_1', 'report_1_retry'],
          report_month: '2026-03',
          recipient_contact_masked: '03****2222',
          delivery_count: 2,
        }),
      }),
    );
    expect(JSON.stringify(upsertOperationalTaskMock.mock.calls[0]?.[1]?.metadata)).not.toContain(
      '03-1111-2222',
    );
    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          dedupe_key: {
            in: expect.arrayContaining([
              'report-response-followup:delivery_waiting',
              'report-response-followup:delivery_waiting_retry',
            ]),
          },
          status: { in: ['pending', 'in_progress'] },
        }),
      }),
    );
    expect(result).toEqual({
      queued_count: 1,
      reminder_task_count: 1,
      queued_delivery_count: 2,
      delivery_ids: ['delivery_waiting', 'delivery_waiting_retry'],
      skipped_snoozed_count: 0,
      skipped_snoozed_dedupe_keys: [],
    });
  });

  it('does not overwrite an existing snoozed reminder task before its future due date', async () => {
    const tx = {
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'delivery_snoozed',
            channel: 'email',
            recipient_name: '在宅主治医A',
            recipient_contact: 'doctor@example.com',
            sent_at: new Date('2026-03-01T09:00:00.000Z'),
            report: {
              id: 'report_snoozed',
              patient_id: 'patient_1',
              report_type: 'physician_report',
              created_by: 'user_1',
              created_at: new Date('2026-03-01T08:30:00.000Z'),
            },
          },
        ]),
      },
      task: {
        create: vi.fn(),
        findMany: vi.fn().mockImplementation((args: { where: { dedupe_key: { in: string[] } } }) =>
          Promise.resolve([
            {
              dedupe_key:
                args.where.dedupe_key.in.find((key) =>
                  key.startsWith('report-response-followup:patient_1:2026-03:'),
                ) ?? 'report-response-followup:patient_1:2026-03:missing',
              due_date: new Date('2026-03-20T00:00:00.000Z'),
              sla_due_at: null,
              metadata: null,
            },
          ]),
        ),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
    } as const;

    const result = await queueOverdueReportResponseReminders(tx, 'org_1', {
      overdueDays: 7,
      now: new Date('2026-03-12T00:00:00.000Z'),
    });

    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      queued_count: 0,
      reminder_task_count: 0,
      queued_delivery_count: 0,
      delivery_ids: [],
      skipped_snoozed_count: 1,
    });
    expect(result.skipped_snoozed_dedupe_keys[0]).toMatch(
      /^report-response-followup:patient_1:2026-03:[a-f0-9]{16}$/,
    );
  });

  it('can snooze selected overdue deliveries without queueing every overdue report', async () => {
    const snoozeUntil = new Date('2026-03-18T00:00:00.000Z');
    const tx = {
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'delivery_selected',
            channel: 'email',
            recipient_name: '在宅主治医A',
            recipient_contact: 'doctor@example.com',
            sent_at: new Date('2026-03-01T09:00:00.000Z'),
            report: {
              id: 'report_selected',
              patient_id: 'patient_1',
              report_type: 'physician_report',
              created_by: 'user_1',
              created_at: new Date('2026-03-01T08:30:00.000Z'),
            },
          },
        ]),
      },
      task: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
    } as const;

    const result = await queueOverdueReportResponseReminders(tx, 'org_1', {
      deliveryIds: ['delivery_selected', 'delivery_selected'],
      overdueDays: 7,
      now: new Date('2026-03-12T00:00:00.000Z'),
      snoozeUntil,
    });

    expect(tx.deliveryRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['delivery_selected'] },
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        priority: 'normal',
        dueDate: snoozeUntil,
        slaDueAt: snoozeUntil,
        metadata: expect.objectContaining({
          snooze_until: '2026-03-18T00:00:00.000Z',
          recipient_contact_masked: 'd***@example.com',
        }),
      }),
    );
    expect(JSON.stringify(upsertOperationalTaskMock.mock.calls[0]?.[1]?.metadata)).not.toContain(
      'doctor@example.com',
    );
    expect(result).toMatchObject({
      queued_count: 1,
      reminder_task_count: 1,
      queued_delivery_count: 1,
      delivery_ids: ['delivery_selected'],
    });
  });
});
