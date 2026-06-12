'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type {
  MonthlyVisitBucket,
  ProcessDuration,
} from '@/lib/analytics/operations-insights';

/**
 * p1_06「在宅業務の動きを見る」: 月ごとの訪問件数と時間がかかっている工程を
 * CSS バーで可視化し、改善のヒントを箇条書きで示す。
 */

type OperationsInsights = {
  monthly_visits: MonthlyVisitBucket[];
  processes: ProcessDuration[];
  hints: string[];
};

const BAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-sky-500'];
const PROCESS_COLORS = [
  'bg-red-400',
  'bg-amber-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
];

function BarChart({
  items,
  ariaLabel,
}: {
  items: Array<{ label: string; value: number; colorClass: string }>;
  ariaLabel: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="flex h-56 items-end gap-4 px-2" role="img" aria-label={ariaLabel}>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="text-xs font-semibold text-foreground">{item.value}</span>
          <div
            className={`w-full rounded-md ${item.colorClass}`}
            style={{ height: `${Math.max((item.value / max) * 78, 2)}%` }}
          />
          <span className="text-[11px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function OperationsInsightsContent() {
  const orgId = useOrgId();

  const insightsQuery = useQuery({
    queryKey: ['admin-operations-insights', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/operations-insights', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('運用分析の取得に失敗しました');
      const json = await res.json();
      return json.data as OperationsInsights;
    },
    enabled: !!orgId,
  });

  if (!orgId || insightsQuery.isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2" role="status" aria-label="運用分析読み込み中">
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg xl:col-span-2" />
      </div>
    );
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="運用分析を表示できません"
          description="集計の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void insightsQuery.refetch() }}
        />
      </div>
    );
  }

  const insights = insightsQuery.data;

  return (
    <div className="space-y-5" data-testid="operations-insights-page">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">在宅業務の動きを見る</h1>
        <div className="flex flex-wrap items-baseline gap-4">
          <Link
            href="/admin/capacity"
            className="text-sm font-medium text-primary hover:underline"
          >
            キャパシティ →
          </Link>
          <Link
            href="/admin/inventory-forecast"
            className="text-sm font-medium text-primary hover:underline"
          >
            在庫と定期処方の予測 →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-border/70 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">月ごとの訪問件数</h2>
          <div className="mt-4">
            <BarChart
              ariaLabel="月ごとの訪問件数"
              items={insights.monthly_visits.map((bucket, index) => ({
                label: bucket.label,
                value: bucket.count,
                colorClass: BAR_COLORS[index % BAR_COLORS.length],
              }))}
            />
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">時間がかかっている工程</h2>
          <div className="mt-4">
            <BarChart
              ariaLabel="工程ごとの平均所要分"
              items={insights.processes.map((process, index) => ({
                label: process.label,
                value: process.averageMinutes,
                colorClass: PROCESS_COLORS[index % PROCESS_COLORS.length],
              }))}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            直近30日の平均所要分(作成から更新までの概算)
          </p>
        </section>
      </div>

      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">改善のヒント</h2>
        {insights.hints.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            直近の実績が少ないため、ヒントはまだありません。
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5" role="list">
            {insights.hints.map((hint) => (
              <li key={hint} className="text-sm leading-6 text-foreground">
                ・{hint}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
