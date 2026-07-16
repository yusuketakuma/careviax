import { Prisma } from '@prisma/client';
import { subDays } from 'date-fns';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildComparableVisitWindows,
  buildImprovementHints,
  buildMonthlyBuckets,
  type ProcessDuration,
} from '@/lib/analytics/operations-insights';
import { japanMonthInstantRange } from '@/lib/utils/date-boundary';

const PROCESS_DEFS = [
  { key: 'intake', label: '入力', startedEvent: '受付作成', completedEvent: '完了イベント未定義' },
  { key: 'audit', label: '監査', startedEvent: '監査記録作成', completedEvent: '監査実施' },
  {
    key: 'set',
    label: 'セット',
    startedEvent: 'セット計画作成',
    completedEvent: '完了イベント未定義',
  },
  { key: 'visit', label: '訪問', startedEvent: '訪問開始', completedEvent: '訪問終了' },
  { key: 'report', label: '報告', startedEvent: '報告作成', completedEvent: '報告確定' },
] as const;

const COMPLETED_VISIT_OUTCOMES = [
  'completed',
  'completed_with_issue',
  'revisit_needed',
  'delivery_only',
] as const;

type MonthlyCountRow = { month_key: string; count: bigint | number };
type ProcessAggregateRow = {
  key: 'audit' | 'visit' | 'report';
  average_minutes: number | string | null;
  sample_count: bigint | number;
};
type ComparisonCountRow = { current_count: bigint | number; previous_count: bigint | number };

function toCount(value: bigint | number) {
  return Number(value);
}

export const GET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    const generatedAt = now.toISOString();
    const buckets = buildMonthlyBuckets(now, 5);
    const earliestMonth = japanMonthInstantRange(buckets[0].key).gte;
    const processWindow = { gte: subDays(now, 30), lt: now };
    const comparisonWindows = buildComparableVisitWindows(now);
    const outcomeValues = Prisma.join(
      COMPLETED_VISIT_OUTCOMES.map((value) => Prisma.sql`${value}`),
    );

    const [monthlyRows, processRows, comparisonRows] = await Promise.all([
      prisma.$queryRaw<MonthlyCountRow[]>(Prisma.sql`
        SELECT
          to_char(("visit_date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') AS month_key,
          COUNT(*)::bigint AS count
        FROM "VisitRecord"
        WHERE "org_id" = ${ctx.orgId}
          AND "visit_date" >= ${earliestMonth}
          AND "visit_date" < ${now}
          AND "outcome_status"::text IN (${outcomeValues})
        GROUP BY month_key
        ORDER BY month_key ASC
      `),
      prisma.$queryRaw<ProcessAggregateRow[]>(Prisma.sql`
        SELECT 'audit'::text AS key,
          ROUND(AVG(EXTRACT(EPOCH FROM ("audited_at" - "created_at")) / 60.0))::double precision AS average_minutes,
          COUNT(*)::bigint AS sample_count
        FROM "DispenseAudit"
        WHERE "org_id" = ${ctx.orgId}
          AND "audited_at" >= ${processWindow.gte} AND "audited_at" < ${processWindow.lt}
          AND "audited_at" >= "created_at"
        UNION ALL
        SELECT 'visit'::text AS key,
          ROUND(AVG(EXTRACT(EPOCH FROM ("visit_ended_at" - "visit_started_at")) / 60.0))::double precision,
          COUNT(*)::bigint
        FROM "VisitRecord"
        WHERE "org_id" = ${ctx.orgId}
          AND "visit_ended_at" >= ${processWindow.gte} AND "visit_ended_at" < ${processWindow.lt}
          AND "visit_started_at" IS NOT NULL AND "visit_ended_at" >= "visit_started_at"
        UNION ALL
        SELECT 'report'::text AS key,
          ROUND(AVG(EXTRACT(EPOCH FROM ("finalized_at" - "created_at")) / 60.0))::double precision,
          COUNT(*)::bigint
        FROM "CareReport"
        WHERE "org_id" = ${ctx.orgId}
          AND "finalized_at" >= ${processWindow.gte} AND "finalized_at" < ${processWindow.lt}
          AND "finalized_at" >= "created_at"
          AND "voided_at" IS NULL
      `),
      prisma.$queryRaw<ComparisonCountRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE "visit_date" >= ${comparisonWindows.current.gte}
              AND "visit_date" < ${comparisonWindows.current.lt}
          )::bigint AS current_count,
          COUNT(*) FILTER (
            WHERE "visit_date" >= ${comparisonWindows.previous.gte}
              AND "visit_date" < ${comparisonWindows.previous.lt}
          )::bigint AS previous_count
        FROM "VisitRecord"
        WHERE "org_id" = ${ctx.orgId}
          AND "outcome_status"::text IN (${outcomeValues})
          AND "visit_date" >= ${comparisonWindows.previous.gte}
          AND "visit_date" < ${comparisonWindows.current.lt}
      `),
    ]);

    const countsByMonth = new Map(monthlyRows.map((row) => [row.month_key, toCount(row.count)]));
    const monthlyVisits = buckets.map((bucket) => ({
      ...bucket,
      count: countsByMonth.get(bucket.key) ?? 0,
    }));
    const aggregateByKey = new Map(processRows.map((row) => [row.key, row]));
    const processes: ProcessDuration[] = PROCESS_DEFS.map((def) => {
      const aggregate = aggregateByKey.get(def.key as ProcessAggregateRow['key']);
      return {
        ...def,
        averageMinutes: aggregate?.average_minutes == null ? 0 : Number(aggregate.average_minutes),
        sampleCount: aggregate ? toCount(aggregate.sample_count) : 0,
      };
    });
    const comparisonRow = comparisonRows[0] ?? { current_count: 0, previous_count: 0 };
    const comparison = {
      currentCount: toCount(comparisonRow.current_count),
      previousCount: toCount(comparisonRow.previous_count),
      currentStart: comparisonWindows.current.gte,
      currentEnd: comparisonWindows.current.lt,
      previousStart: comparisonWindows.previous.gte,
      previousEnd: comparisonWindows.previous.lt,
    };

    return success({
      data: {
        generated_at: generatedAt,
        timezone: 'Asia/Tokyo',
        process_window: {
          start: processWindow.gte.toISOString(),
          end: processWindow.lt.toISOString(),
        },
        comparison: {
          current: {
            start: comparison.currentStart.toISOString(),
            end: comparison.currentEnd.toISOString(),
            count: comparison.currentCount,
          },
          previous: {
            start: comparison.previousStart.toISOString(),
            end: comparison.previousEnd.toISOString(),
            count: comparison.previousCount,
          },
        },
        monthly_visits: monthlyVisits,
        processes,
        hints: buildImprovementHints({ monthlyVisits, processes, comparison }),
      },
    });
  },
  { permission: 'canAdmin', message: '運用分析の閲覧権限がありません' },
);
