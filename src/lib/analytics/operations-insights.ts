import { addMonths, differenceInMinutes, format, startOfMonth } from 'date-fns';

/**
 * p1_06「在宅業務の動きを見る」の集計純関数。
 * 月ごとの訪問件数バケットと、工程ごとの平均所要分(作成→更新の概算)を作る。
 */

export type MonthlyVisitBucket = {
  key: string;
  label: string;
  count: number;
};

/** 直近 monthsBack ヶ月(当月含む)の空バケットを作る。 */
export function buildMonthlyBuckets(now: Date, monthsBack = 5): MonthlyVisitBucket[] {
  const start = startOfMonth(now);
  return Array.from({ length: monthsBack }, (_, index) => {
    const month = addMonths(start, index - (monthsBack - 1));
    return { key: format(month, 'yyyy-MM'), label: `${month.getMonth() + 1}月`, count: 0 };
  });
}

export function tallyMonthlyVisits(
  buckets: MonthlyVisitBucket[],
  visitDates: Date[],
): MonthlyVisitBucket[] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, { ...bucket }]));
  for (const visitDate of visitDates) {
    const key = format(visitDate, 'yyyy-MM');
    const bucket = byKey.get(key);
    if (bucket) bucket.count += 1;
  }
  return [...byKey.values()];
}

export type ProcessDuration = {
  key: string;
  label: string;
  averageMinutes: number;
  sampleCount: number;
};

/** created→completed ペアから平均所要分(整数)を出す。0件は 0。 */
export function averageDurationMinutes(
  pairs: Array<{ startedAt: Date; endedAt: Date }>,
): { averageMinutes: number; sampleCount: number } {
  const durations = pairs
    .map((pair) => differenceInMinutes(pair.endedAt, pair.startedAt))
    .filter((minutes) => minutes >= 0);
  if (durations.length === 0) return { averageMinutes: 0, sampleCount: 0 };
  const total = durations.reduce((sum, minutes) => sum + minutes, 0);
  return { averageMinutes: Math.round(total / durations.length), sampleCount: durations.length };
}

/** 集計結果から改善のヒントを導出する(実データ起点、最大4件)。 */
export function buildImprovementHints(args: {
  monthlyVisits: MonthlyVisitBucket[];
  processes: ProcessDuration[];
}): string[] {
  const hints: string[] = [];

  const slowest = [...args.processes]
    .filter((process) => process.sampleCount > 0)
    .sort((left, right) => right.averageMinutes - left.averageMinutes)[0];
  if (slowest) {
    hints.push(`「${slowest.label}」に最も時間がかかっています(平均${slowest.averageMinutes}分)`);
  }

  const last = args.monthlyVisits.at(-1);
  const previous = args.monthlyVisits.at(-2);
  if (last && previous && previous.count > 0) {
    const delta = last.count - previous.count;
    hints.push(
      delta >= 0
        ? `訪問件数は前月より${delta}件増えています`
        : `訪問件数は前月より${Math.abs(delta)}件減っています`,
    );
  }

  const noSample = args.processes.filter((process) => process.sampleCount === 0);
  if (noSample.length > 0) {
    hints.push(`${noSample.map((process) => process.label).join('・')}は直近の実績がありません`);
  }

  return hints.slice(0, 4);
}
