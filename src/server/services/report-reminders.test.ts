import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deliveryRecordFindManyMock, patientFindManyMock, upsertOperationalTaskMock } =
  vi.hoisted(() => ({
    deliveryRecordFindManyMock: vi.fn(),
    patientFindManyMock: vi.fn(),
    upsertOperationalTaskMock: vi.fn(),
  }));

vi.mock('@/lib/db', () => ({
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
      ])
    );
    expect(result.overdue_waiting).toEqual([
      expect.objectContaining({
        id: 'delivery_waiting',
        patient_name: '佐藤 花子',
        report_type: 'physician_report',
        days_waiting: 11,
      }),
    ]);
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
            },
          },
        ]),
      },
      task: {
        create: vi.fn(),
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
        dedupeKey: 'report-response-followup:delivery_waiting',
        relatedEntityType: 'delivery_record',
        relatedEntityId: 'delivery_waiting',
      })
    );
    expect(result).toEqual({
      queued_count: 1,
      delivery_ids: ['delivery_waiting'],
    });
  });
});
