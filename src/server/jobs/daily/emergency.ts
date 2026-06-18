import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { buildEmergencyCoverageGapTaskKey, formatDateKey } from '../daily-helpers';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

export async function checkEmergencyCoverageGaps() {
  return runJob('emergency_coverage_gap_check', async () => {
    // holiday / shift の date(@db.Date)比較用: ローカル日付の UTC 深夜境界
    const today = utcDateFromLocalKey(localDateKey());
    const horizon = addUtcDays(today, 3);

    const [holidays, shifts] = await Promise.all([
      prisma.businessHoliday.findMany({
        where: {
          date: {
            gte: today,
            lte: horizon,
          },
        },
        select: {
          org_id: true,
          site_id: true,
          date: true,
          name: true,
          is_closed: true,
        },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          date: {
            gte: today,
            lte: horizon,
          },
          available: true,
          user: {
            is_active: true,
            can_accept_emergency: true,
          },
        },
        select: {
          org_id: true,
          site_id: true,
          date: true,
          user_id: true,
        },
      }),
    ]);

    const shiftCoverage = new Set(
      shifts.map(
        (shift) => `${shift.org_id}:${shift.site_id ?? 'org'}:${formatDateKey(shift.date)}`,
      ),
    );

    let processedCount = 0;
    for (const holiday of holidays.filter((item) => item.is_closed)) {
      const dateKey = formatDateKey(holiday.date);
      const coverageKey = `${holiday.org_id}:${holiday.site_id ?? 'org'}:${dateKey}`;
      if (shiftCoverage.has(coverageKey)) continue;

      await withOrgContext(holiday.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: holiday.org_id,
          taskType: 'emergency_coverage_gap',
          title: `${dateKey} の時間外・緊急対応体制が未設定です`,
          description: `${holiday.name} の当番薬剤師または応援体制を確認してください。`,
          priority: 'urgent',
          dueDate: holiday.date,
          slaDueAt: holiday.date,
          relatedEntityType: 'business_holiday',
          relatedEntityId: `${holiday.site_id ?? 'org'}:${dateKey}`,
          dedupeKey: buildEmergencyCoverageGapTaskKey(dateKey, holiday.site_id),
          metadata: {
            holiday_name: holiday.name,
            site_id: holiday.site_id,
          },
        }),
      );
      processedCount += 1;
    }

    return { processedCount };
  });
}
