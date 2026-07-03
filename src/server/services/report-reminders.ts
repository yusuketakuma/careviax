import { createHash } from 'crypto';
import { addDays, differenceInCalendarDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { japanDateKey, japanMonthInstantRange } from '@/lib/utils/date-boundary';
import { REPORT_TYPE_LABELS } from '@/lib/constants/status-labels';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { maskContactValueForAudit } from '@/lib/privacy/contact-mask';

type Tx = {
  deliveryRecord: Pick<Prisma.TransactionClient['deliveryRecord'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'create' | 'findMany' | 'updateMany' | 'upsert'>;
};

type DeliveryAnalyticsDb = Pick<Prisma.TransactionClient, 'deliveryRecord' | 'patient'>;

type DeliveryAnalyticsOptions = {
  months?: number;
  overdueDays?: number;
  now?: Date;
};

/**
 * 実時刻の DateTime(created_at / sent_at)を JST 民間月キー 'YYYY-MM' に落とす。
 * サーバーローカルの getMonth だと UTC prod で JST 月初/月末の配信を隣月へずらす。
 */
function formatMonth(value: Date) {
  return japanDateKey(value).slice(0, 7);
}

/** 月キー 'YYYY-MM' を delta か月ずらした月キーを返す(UTC 基準、ランタイム TZ 非依存)。 */
function shiftMonthKey(monthKey: string, delta: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildLegacyReportResponseReminderTaskKey(deliveryId: string) {
  return `report-response-followup:${deliveryId}`;
}

function maskDeliveryContact(value: string | null) {
  return maskContactValueForAudit(value, { phoneLeadingDigits: 2 }) ?? '';
}

function hashReminderRecipient(input: {
  channel: string;
  recipientName: string;
  recipientContact: string | null;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        channel: input.channel,
        recipient_name: input.recipientName.trim(),
        recipient_contact: input.recipientContact?.trim() ?? '',
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function buildReportResponseReminderTaskKey(input: {
  patientId: string;
  reportMonth: string;
  channel: string;
  recipientName: string;
  recipientContact: string | null;
}) {
  const recipientHash = hashReminderRecipient(input);
  return `report-response-followup:${input.patientId}:${input.reportMonth}:${recipientHash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFutureDate(value: unknown, now: Date) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed <= now ? null : parsed;
}

function readSnoozeUntil(metadata: Prisma.JsonValue | null, now: Date) {
  if (!isRecord(metadata)) return null;
  return parseFutureDate(metadata.snooze_until, now);
}

type ReminderDelivery = {
  id: string;
  channel: string;
  recipient_name: string;
  recipient_contact: string | null;
  sent_at: Date | null;
  report: {
    id: string;
    patient_id: string;
    report_type: string;
    created_by: string;
    created_at: Date;
  };
};

type ReminderGroup = {
  dedupeKey: string;
  legacyDedupeKeys: string[];
  reportMonth: string;
  patientId: string;
  channel: string;
  recipientName: string;
  recipientContactMasked: string;
  deliveries: ReminderDelivery[];
  earliestSentAt: Date;
  latestSentAt: Date;
  maxDaysWaiting: number;
  reportType: string;
  createdBy: string;
  reportIds: string[];
};

function createReminderGroup(delivery: ReminderDelivery, now: Date): ReminderGroup | null {
  if (!delivery.sent_at) return null;
  const reportMonth = formatMonth(delivery.report.created_at);
  const dedupeKey = buildReportResponseReminderTaskKey({
    patientId: delivery.report.patient_id,
    reportMonth,
    channel: delivery.channel,
    recipientName: delivery.recipient_name,
    recipientContact: delivery.recipient_contact,
  });
  const daysWaiting = differenceInCalendarDays(now, delivery.sent_at);

  return {
    dedupeKey,
    legacyDedupeKeys: [buildLegacyReportResponseReminderTaskKey(delivery.id)],
    reportMonth,
    patientId: delivery.report.patient_id,
    channel: delivery.channel,
    recipientName: delivery.recipient_name,
    recipientContactMasked: maskDeliveryContact(delivery.recipient_contact),
    deliveries: [delivery],
    earliestSentAt: delivery.sent_at,
    latestSentAt: delivery.sent_at,
    maxDaysWaiting: daysWaiting,
    reportType: delivery.report.report_type,
    createdBy: delivery.report.created_by,
    reportIds: [delivery.report.id],
  };
}

function addDeliveryToReminderGroup(group: ReminderGroup, delivery: ReminderDelivery, now: Date) {
  if (!delivery.sent_at) return;
  group.deliveries.push(delivery);
  group.legacyDedupeKeys.push(buildLegacyReportResponseReminderTaskKey(delivery.id));
  if (delivery.sent_at < group.earliestSentAt) group.earliestSentAt = delivery.sent_at;
  if (delivery.sent_at > group.latestSentAt) group.latestSentAt = delivery.sent_at;
  group.maxDaysWaiting = Math.max(
    group.maxDaysWaiting,
    differenceInCalendarDays(now, delivery.sent_at),
  );
  if (!group.reportIds.includes(delivery.report.id)) group.reportIds.push(delivery.report.id);
}

export async function getCareReportDeliveryAnalytics(
  orgId: string,
  options: DeliveryAnalyticsOptions = {},
  db: DeliveryAnalyticsDb = prisma,
) {
  const now = options.now ?? new Date();
  const overdueDays = options.overdueDays ?? 7;
  const months = options.months ?? 6;
  // JST 民間月でトレンドを組む(created_at は実時刻の DateTime)。
  const currentMonthKey = formatMonth(now);
  const trendMonthKeys = Array.from({ length: months }, (_, index) =>
    shiftMonthKey(currentMonthKey, -(months - 1 - index)),
  );
  const rangeStart = japanMonthInstantRange(trendMonthKeys[0]).gte;

  const deliveries = await db.deliveryRecord.findMany({
    where: {
      org_id: orgId,
      report: { org_id: orgId },
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
    new Set(deliveries.map((item) => item.report.patient_id).filter(Boolean)),
  );
  const patients =
    patientIds.length === 0
      ? []
      : await db.patient.findMany({
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
    return {
      month: trendMonthKeys[index],
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
        recipient_contact: maskDeliveryContact(item.recipient_contact),
        recipient_contact_masked: maskDeliveryContact(item.recipient_contact),
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
    const monthKey = formatMonth(deliveryDate);
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

  const currentMonthBucket =
    monthlyByMonth.get(currentMonthKey) ?? monthlyTrend[monthlyTrend.length - 1];

  const physicianSummary = Array.from(physicianBreakdown.values())
    .map((item) => ({
      ...item,
      success_rate:
        item.total_count === 0 ? 0 : Math.round((item.success_count / item.total_count) * 100),
    }))
    .sort(
      (left, right) =>
        right.total_count - left.total_count ||
        right.success_rate - left.success_rate ||
        left.recipient_name.localeCompare(right.recipient_name, 'ja'),
    )
    .slice(0, 5);

  const channelSummary = Array.from(channelBreakdown.values())
    .map((item) => ({
      ...item,
      success_rate:
        item.total_count === 0 ? 0 : Math.round((item.success_count / item.total_count) * 100),
    }))
    .sort(
      (left, right) =>
        right.total_count - left.total_count ||
        right.success_rate - left.success_rate ||
        left.channel.localeCompare(right.channel, 'ja'),
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
  options: Pick<DeliveryAnalyticsOptions, 'overdueDays' | 'now'> & {
    deliveryIds?: string[];
    snoozeUntil?: Date | null;
  } = {},
) {
  const now = options.now ?? new Date();
  const overdueDays = options.overdueDays ?? 7;
  const threshold = addDays(now, -overdueDays);
  const deliveryIds = options.deliveryIds
    ? Array.from(new Set(options.deliveryIds.map((id) => id.trim()).filter(Boolean)))
    : [];
  const snoozeUntil = options.snoozeUntil && options.snoozeUntil > now ? options.snoozeUntil : null;

  const deliveries = (await tx.deliveryRecord.findMany({
    where: {
      org_id: orgId,
      ...(deliveryIds.length > 0 ? { id: { in: deliveryIds } } : {}),
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
          created_at: true,
        },
      },
    },
    orderBy: [{ sent_at: 'asc' }],
  })) as ReminderDelivery[];

  const groups = new Map<string, ReminderGroup>();
  for (const delivery of deliveries) {
    const group = createReminderGroup(delivery, now);
    if (!group) continue;

    const existing = groups.get(group.dedupeKey);
    if (existing) {
      addDeliveryToReminderGroup(existing, delivery, now);
      continue;
    }
    groups.set(group.dedupeKey, group);
  }

  const dedupeKeys = Array.from(
    new Set(
      Array.from(groups.values()).flatMap((group) => [group.dedupeKey, ...group.legacyDedupeKeys]),
    ),
  );
  const existingTasks =
    dedupeKeys.length === 0
      ? []
      : await tx.task.findMany({
          where: {
            org_id: orgId,
            dedupe_key: { in: dedupeKeys },
            status: { in: ['pending', 'in_progress'] },
          },
          select: {
            dedupe_key: true,
            due_date: true,
            sla_due_at: true,
            metadata: true,
          },
        });
  const existingTaskByDedupeKey = new Map(
    existingTasks
      .filter((task) => task.dedupe_key)
      .map((task) => [task.dedupe_key as string, task]),
  );

  const queuedDeliveryIds: string[] = [];
  let queuedTaskCount = 0;
  const skippedSnoozedDedupeKeys: string[] = [];

  for (const group of groups.values()) {
    const matchingExistingTask =
      existingTaskByDedupeKey.get(group.dedupeKey) ??
      group.legacyDedupeKeys
        .map((dedupeKey) => existingTaskByDedupeKey.get(dedupeKey))
        .find((task): task is NonNullable<typeof task> => Boolean(task));
    const existingSnoozeUntil =
      matchingExistingTask?.due_date && matchingExistingTask.due_date > now
        ? matchingExistingTask.due_date
        : readSnoozeUntil(matchingExistingTask?.metadata ?? null, now);

    if (!snoozeUntil && existingSnoozeUntil) {
      skippedSnoozedDedupeKeys.push(group.dedupeKey);
      continue;
    }

    const effectiveDedupeKey = matchingExistingTask?.dedupe_key ?? group.dedupeKey;
    const reportTypeLabel = REPORT_TYPE_LABELS[group.reportType] ?? group.reportType;
    const dueDate = snoozeUntil ?? addDays(group.earliestSentAt, overdueDays);
    const slaDueAt = snoozeUntil ?? addDays(group.earliestSentAt, overdueDays + 1);

    await upsertOperationalTask(tx, {
      orgId,
      taskType: 'report_response_followup',
      title: '未確認報告書のフォローが必要です',
      description:
        group.deliveries.length === 1
          ? `${group.recipientName} へ送付した ${reportTypeLabel} が ${group.maxDaysWaiting}日未確認です。`
          : `${group.recipientName} へ送付した ${reportTypeLabel} ほか${group.deliveries.length}件が最大${group.maxDaysWaiting}日未確認です。`,
      priority: snoozeUntil
        ? 'normal'
        : group.maxDaysWaiting >= overdueDays * 2
          ? 'urgent'
          : 'high',
      assignedTo: group.createdBy,
      dueDate,
      slaDueAt,
      dedupeKey: effectiveDedupeKey,
      relatedEntityType: 'care_report',
      relatedEntityId: group.reportIds[0] ?? null,
      metadata: {
        delivery_record_id: group.deliveries[0]?.id ?? null,
        delivery_record_ids: group.deliveries.map((item) => item.id),
        report_id: group.reportIds[0] ?? null,
        report_ids: group.reportIds,
        patient_id: group.patientId,
        report_month: group.reportMonth,
        report_type: group.reportType,
        recipient_name: group.recipientName,
        recipient_contact_masked: group.recipientContactMasked,
        recipient_key_hash: hashReminderRecipient({
          channel: group.channel,
          recipientName: group.recipientName,
          recipientContact: group.deliveries[0]?.recipient_contact ?? null,
        }),
        channel: group.channel,
        sent_at: group.earliestSentAt.toISOString(),
        latest_sent_at: group.latestSentAt.toISOString(),
        days_waiting: group.maxDaysWaiting,
        delivery_count: group.deliveries.length,
        ...(snoozeUntil ? { snooze_until: snoozeUntil.toISOString() } : {}),
      },
    });
    queuedTaskCount += 1;
    queuedDeliveryIds.push(...group.deliveries.map((item) => item.id));
  }

  return {
    queued_count: queuedTaskCount,
    reminder_task_count: queuedTaskCount,
    queued_delivery_count: queuedDeliveryIds.length,
    delivery_ids: queuedDeliveryIds,
    skipped_snoozed_count: skippedSnoozedDedupeKeys.length,
    skipped_snoozed_dedupe_keys: skippedSnoozedDedupeKeys,
  };
}
