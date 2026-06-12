import { subDays } from 'date-fns';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  averageDurationMinutes,
  buildImprovementHints,
  buildMonthlyBuckets,
  tallyMonthlyVisits,
  type ProcessDuration,
} from '@/lib/analytics/operations-insights';

/**
 * p1_06「在宅業務の動きを見る」: 月ごとの訪問件数(直近5ヶ月)と
 * 工程ごとの平均所要分(直近30日、作成→更新時刻の概算)を返す BFF。
 */

const PROCESS_DEFS = [
  { key: 'intake', label: '入力' },
  { key: 'audit', label: '監査' },
  { key: 'set', label: 'セット' },
  { key: 'visit', label: '訪問' },
  { key: 'report', label: '報告' },
] as const;

export const GET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    const buckets = buildMonthlyBuckets(now, 5);
    const earliestMonth = new Date(`${buckets[0].key}-01T00:00:00`);
    const recentWindow = subDays(now, 30);

    const [visitRecords, intakes, audits, setPlans, reports] = await Promise.all([
      prisma.visitRecord.findMany({
        where: {
          org_id: ctx.orgId,
          visit_date: { gte: earliestMonth },
          outcome_status: {
            in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
          },
        },
        select: { visit_date: true },
      }),
      prisma.prescriptionIntake.findMany({
        where: { org_id: ctx.orgId, created_at: { gte: recentWindow } },
        select: { created_at: true, updated_at: true },
      }),
      prisma.dispenseAudit.findMany({
        where: { org_id: ctx.orgId, audited_at: { gte: recentWindow } },
        select: { created_at: true, audited_at: true },
      }),
      prisma.setPlan.findMany({
        where: { org_id: ctx.orgId, created_at: { gte: recentWindow } },
        select: { created_at: true, updated_at: true },
      }),
      prisma.careReport.findMany({
        where: { org_id: ctx.orgId, created_at: { gte: recentWindow } },
        select: { created_at: true, updated_at: true },
      }),
    ]);

    const monthlyVisits = tallyMonthlyVisits(
      buckets,
      visitRecords.map((record) => record.visit_date),
    );

    const visitDurationsSource = await prisma.visitRecord.findMany({
      where: { org_id: ctx.orgId, created_at: { gte: recentWindow } },
      select: { created_at: true, updated_at: true },
    });

    const durationsByKey: Record<string, { averageMinutes: number; sampleCount: number }> = {
      intake: averageDurationMinutes(
        intakes.map((row) => ({ startedAt: row.created_at, endedAt: row.updated_at })),
      ),
      audit: averageDurationMinutes(
        audits.map((row) => ({ startedAt: row.created_at, endedAt: row.audited_at })),
      ),
      set: averageDurationMinutes(
        setPlans.map((row) => ({ startedAt: row.created_at, endedAt: row.updated_at })),
      ),
      visit: averageDurationMinutes(
        visitDurationsSource.map((row) => ({ startedAt: row.created_at, endedAt: row.updated_at })),
      ),
      report: averageDurationMinutes(
        reports.map((row) => ({ startedAt: row.created_at, endedAt: row.updated_at })),
      ),
    };

    const processes: ProcessDuration[] = PROCESS_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      averageMinutes: durationsByKey[def.key].averageMinutes,
      sampleCount: durationsByKey[def.key].sampleCount,
    }));

    return success({
      data: {
        monthly_visits: monthlyVisits,
        processes,
        hints: buildImprovementHints({ monthlyVisits, processes }),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '運用分析の閲覧権限がありません',
  },
);
