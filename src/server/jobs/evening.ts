import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { runJob } from './runner';

/**
 * 薬歴未記入リマインド（当日夕方）
 * 当日の完了済み訪問でVisitRecordが未作成のスケジュールを検出し、担当薬剤師に通知する
 */
export async function checkUnrecordedVisits() {
  return runJob('unrecorded_visit_check', async () => {
    // 当日の完了済みスケジュールを取得(scheduled_date は @db.Date のため UTC レンジで比較)
    const completedSchedules = await prisma.visitSchedule.findMany({
      where: {
        scheduled_date: todayUtcRange(),
        schedule_status: 'completed',
      },
      select: { id: true, org_id: true, pharmacist_id: true },
    });

    if (completedSchedules.length === 0) {
      return { processedCount: 0 };
    }

    // VisitRecordが既に存在するschedule_idを取得
    const scheduleIds = completedSchedules.map((s) => s.id);
    const existingRecords = await prisma.visitRecord.findMany({
      where: { schedule_id: { in: scheduleIds } },
      select: { schedule_id: true },
    });
    const recordedIds = new Set(existingRecords.map((r) => r.schedule_id));

    // VisitRecordが未作成のスケジュールをフィルタ
    const unrecorded = completedSchedules.filter((s) => !recordedIds.has(s.id));
    const notifications: Prisma.NotificationCreateManyInput[] = unrecorded.map((schedule) => ({
      org_id: schedule.org_id,
      user_id: schedule.pharmacist_id,
      type: 'reminder',
      title: '薬歴未記入',
      message: '本日の訪問記録が未入力です。薬歴を記入してください。',
      link: `/visit-schedules/${schedule.id}`,
      dedupe_key: `unrecorded-visit:${schedule.id}:${schedule.pharmacist_id}`,
    }));

    const notificationResult =
      notifications.length === 0
        ? { count: 0 }
        : await prisma.notification.createMany({
            data: notifications,
            skipDuplicates: true,
          });

    return { processedCount: notificationResult.count };
  });
}

export async function runEveningOperations() {
  return runJob('evening', async () => {
    const result = await checkUnrecordedVisits();
    return {
      processedCount: result.processedCount,
      errors: 'errors' in result ? result.errors : undefined,
    };
  });
}
