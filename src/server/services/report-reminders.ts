import { addDays, differenceInCalendarDays, startOfMonth, subMonths } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { REPORT_TYPE_LABELS } from '@/lib/constants/status-labels';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

type Tx = {
  deliveryRecord: Pick<Prisma.TransactionClient['deliveryRecord'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'create' | 'updateMany' | 'upsert'>;
};

type DeliveryAnalyticsOptions = {
  months?: number;
  overdueDays?: number;
  now?: Date;
};

function formatMonth(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildReportResponseReminderTaskKey(deliveryId: string) {
  return `report-response-followup:${deliveryId}`;
}

export async function getCareReportDeliveryAnalytics(
  orgId: string,
  options: DeliveryAnalyticsOptions = {}
) {
  const now = options.now ?? new Date();
  const overdueDays = options.overdueDays ?? 7;
  const months = options.months ?? 6;
  const currentMonth = startOfMonth(now);
  const rangeStart = startOfMonth(subMonths(currentMonth, months - 1));

  const deliveries = await prisma.deliveryRecord.findMany({
    where: {
      org_id: orgId,
      OR: [
        { created_at: { gte: rangeStart } },
        {
          status: 'response_waiting',
          sent_at: {
            not: null,
          },
        },
      ],
    },
    select: {
      id: true,
      channel: true,
      recipient_name: true,
      recipient_contact: true,
      status: true,
      sent_at: true,
      created_at: true,
      report: {
        select: {
          id: true,
          patient_id: true,
          report_type: true,
          created_by: true,
        },
      },
    },
    orderBy: [{ created_at: 'desc' }],
  });

  const patientIds = Array.from(
    new Set(deliveries.map((item) => item.report.patient_id).filter(Boolean))
  );
  const patients =
    patientIds.length === 0
      ? []
      : await prisma.patient.findMany({
          where: {
            org_id: orgId,
            id: { in: patientIds },
          },
          select: {
            id: true,
            name: true,
          },
        });
  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

  const monthlyTrend = Array.from({ length: months }, (_, index) => {
    const month = startOfMonth(subMonths(currentMonth, months - index - 1));
    return {
      month: formatMonth(month),
      attempted_count: 0,
      success_count: 0,
      failed_count: 0,
      confirmed_count: 0,
      response_waiting_count: 0,
      success_rate: 0,
      confirmed_rate: 0,
    };
  });
  const monthlyByMonth = new Map(monthlyTrend.map((item) => [item.month, item]));
  const physicianBreakdown = new Map<
    string,
    {
      recipient_name: string;
      total_count: number;
      success_count: number;
      confirmed_count: number;
      success_rate: number;
    }
  >();
  const channelBreakdown = new Map<
    string,
    {
      channel: string;
      total_count: number;
      success_count: number;
      failed_count: number;
      success_rate: number;
    }
  >();

  const overdueWaiting = deliveries
    .filter((item) => item.status === 'response_waiting' && item.sent_at)
    .map((item) => {
      const daysWaiting = differenceInCalendarDays(now, item.sent_at as Date);
      return {
        id: item.id,
        report_id: item.report.id,
        patient_id: item.report.patient_id,
        patient_name: patientNameById.get(item.report.patient_id) ?? '患者未登録',
        report_type: item.report.report_type,
        recipient_name: item.recipient_name,
        recipient_contact: item.recipient_contact,
        channel: item.channel,
        sent_at: (item.sent_at as Date).toISOString(),
        days_waiting: daysWaiting,
      };
    })
    .filter((item) => item.days_waiting >= overdueDays)
    .sort((left, right) => right.days_waiting - left.days_waiting);

  for (const delivery of deliveries) {
    if (delivery.status === 'draft') continue;

    const deliveryDate = delivery.sent_at ?? delivery.created_at;
    const monthKey = formatMonth(startOfMonth(deliveryDate));
    const monthBucket = monthlyByMonth.get(monthKey);
    const isSuccess = delivery.status !== 'failed';
    const isConfirmed = delivery.status === 'confirmed';

    if (monthBucket) {
      monthBucket.attempted_count += 1;
      if (isSuccess) monthBucket.success_count += 1;
      if (delivery.status === 'failed') monthBucket.failed_count += 1;
      if (isConfirmed) monthBucket.confirmed_count += 1;
      if (delivery.status === 'response_waiting') monthBucket.response_waiting_count += 1;
    }

    const channelBucket = channelBreakdown.get(delivery.channel) ?? {
      channel: delivery.channel,
      total_count: 0,
      success_count: 0,
      failed_count: 0,
      success_rate: 0,
    };
    channelBucket.total_count += 1;
    if (isSuccess) channelBucket.success_count += 1;
    if (!isSuccess) channelBucket.failed_count += 1;
    channelBreakdown.set(delivery.channel, channelBucket);

    if (delivery.report.report_type === 'physician_report') {
      const physicianBucket = physicianBreakdown.get(delivery.recipient_name) ?? {
        recipient_name: delivery.recipient_name,
        total_count: 0,
        success_count: 0,
        confirmed_count: 0,
        success_rate: 0,
      };
      physicianBucket.total_count += 1;
      if (isSuccess) physicianBucket.success_count += 1;
      if (isConfirmed) physicianBucket.confirmed_count += 1;
      physicianBreakdown.set(delivery.recipient_name, physicianBucket);
    }
  }

  for (const bucket of monthlyTrend) {
    bucket.success_rate =
      bucket.attempted_count === 0
        ? 0
        : Math.round((bucket.success_count / bucket.attempted_count) * 100);
    bucket.confirmed_rate =
      bucket.attempted_count === 0
        ? 0
        : Math.round((bucket.confirmed_count / bucket.attempted_count) * 100);
  }

  const currentMonthKey = formatMonth(currentMonth);
  const currentMonthBucket =
    monthlyByMonth.get(currentMonthKey) ?? monthlyTrend[monthlyTrend.length - 1];

  const physicianSummary = Array.from(physicianBreakdown.values())
    .map((item) => ({
      ...item,
      success_rate:
        item.total_count === 0
          ? 0
          : Math.round((item.success_count / item.total_count) * 100),
    }))
    .sort(
      (left, right) =>
        right.total_count - left.total_count ||
        right.success_rate - left.success_rate ||
        left.recipient_name.localeCompare(right.recipient_name, 'ja')
    )
    .slice(0, 5);

  const channelSummary = Array.from(channelBreakdown.values())
    .map((item) => ({
      ...item,
      success_rate:
        item.total_count === 0
          ? 0
          : Math.round((item.success_count / item.total_count) * 100),
    }))
    .sort(
      (left, right) =>
        right.total_count - left.total_count ||
        right.success_rate - left.success_rate ||
        left.channel.localeCompare(right.channel, 'ja')
    );

  return {
    summary: {
      current_month: currentMonthKey,
      current_month_attempted_count: currentMonthBucket.attempted_count,
      current_month_success_rate: currentMonthBucket.success_rate,
      current_month_failed_count: currentMonthBucket.failed_count,
      current_month_confirmed_rate: currentMonthBucket.confirmed_rate,
      overdue_waiting_count: overdueWaiting.length,
      overdue_threshold_days: overdueDays,
    },
    monthly_trend: monthlyTrend,
    physician_breakdown: physicianSummary,
    channel_breakdown: channelSummary,
    overdue_waiting: overdueWaiting,
  };
}

export async function queueOverdueReportResponseReminders(
  tx: Tx,
  orgId: string,
  options: Pick<DeliveryAnalyticsOptions, 'overdueDays' | 'now'> = {}
) {
  const now = options.now ?? new Date();
  const overdueDays = options.overdueDays ?? 7;
  const threshold = addDays(now, -overdueDays);

  const deliveries = await tx.deliveryRecord.findMany({
    where: {
      org_id: orgId,
      status: 'response_waiting',
      sent_at: {
        not: null,
        lte: threshold,
      },
    },
    select: {
      id: true,
      channel: true,
      recipient_name: true,
      recipient_contact: true,
      sent_at: true,
      report: {
        select: {
          id: true,
          patient_id: true,
          report_type: true,
          created_by: true,
        },
      },
    },
    orderBy: [{ sent_at: 'asc' }],
  });

  for (const delivery of deliveries) {
    if (!delivery.sent_at) continue;

    const daysWaiting = differenceInCalendarDays(now, delivery.sent_at);
    const reportTypeLabel =
      REPORT_TYPE_LABELS[delivery.report.report_type] ?? delivery.report.report_type;

    await upsertOperationalTask(tx, {
      orgId,
      taskType: 'report_response_followup',
      title: '未確認報告書のフォローが必要です',
      description: `${delivery.recipient_name} へ送付した ${reportTypeLabel} が ${daysWaiting}日未確認です。`,
      priority: daysWaiting >= overdueDays * 2 ? 'urgent' : 'high',
      assignedTo: delivery.report.created_by,
      dueDate: addDays(delivery.sent_at, overdueDays),
      slaDueAt: addDays(delivery.sent_at, overdueDays + 1),
      dedupeKey: buildReportResponseReminderTaskKey(delivery.id),
      relatedEntityType: 'delivery_record',
      relatedEntityId: delivery.id,
      metadata: {
        report_id: delivery.report.id,
        patient_id: delivery.report.patient_id,
        report_type: delivery.report.report_type,
        recipient_name: delivery.recipient_name,
        recipient_contact: delivery.recipient_contact,
        channel: delivery.channel,
        sent_at: delivery.sent_at.toISOString(),
        days_waiting: daysWaiting,
      },
    });
  }

  return {
    queued_count: deliveries.length,
    delivery_ids: deliveries.map((item) => item.id),
  };
}
