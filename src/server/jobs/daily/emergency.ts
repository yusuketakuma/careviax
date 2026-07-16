import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { buildEmergencyCoverageGapTaskKey } from '../daily-helpers';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { listOrganizationIds } from '../organization-iteration';

export async function checkEmergencyCoverageGaps() {
  return runJob('emergency_coverage_gap_check', async () => {
    // holiday / shift の date(@db.Date)比較用: 日本業務日の UTC 深夜境界
    const today = utcDateFromLocalKey(japanDateKey());
    const horizon = addUtcDays(today, 3);

    const orgIds = await listOrganizationIds(prisma);
    let processedCount = 0;
    for (const orgId of orgIds) {
      const [holidays, shifts] = await withOrgContext(orgId, (tx) =>
        Promise.all([
          tx.businessHoliday.findMany({
            where: {
              org_id: orgId,
              date: {
                gte: today,
                lte: horizon,
              },
            },
            select: {
              site_id: true,
              date: true,
              name: true,
              is_closed: true,
            },
          }),
          tx.pharmacistShift.findMany({
            where: {
              org_id: orgId,
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
              site_id: true,
              date: true,
              user_id: true,
            },
          }),
        ]),
      );

      const shiftCoverage = new Set(
        shifts.map((shift) => `${shift.site_id ?? 'org'}:${japanDateKey(shift.date)}`),
      );

      for (const holiday of holidays.filter((item) => item.is_closed)) {
        const dateKey = japanDateKey(holiday.date);
        const coverageKey = `${holiday.site_id ?? 'org'}:${dateKey}`;
        if (shiftCoverage.has(coverageKey)) continue;

        await withOrgContext(orgId, (tx) =>
          upsertOperationalTask(tx, {
            orgId,
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
    }

    return { processedCount };
  });
}
