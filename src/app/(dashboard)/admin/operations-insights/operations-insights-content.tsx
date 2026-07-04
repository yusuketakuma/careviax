'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StatCard } from '@/components/ui/stat-card';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { MonthlyVisitBucket, ProcessDuration } from '@/lib/analytics/operations-insights';
import {
  formatOperationDuration,
  summarizeOperationsInsights,
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

// グラフ系列色は状態色ではない → --chart-* トークンを循環使用
const BAR_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-5', 'bg-chart-1'];
const PROCESS_COLORS = ['bg-chart-4', 'bg-chart-3', 'bg-chart-1', 'bg-chart-2', 'bg-chart-5'];

function BarChart({
  items,
  ariaLabel,
}: {
  items: Array<{ label: string; value: number; valueLabel?: string; colorClass: string }>;
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
          <span className="text-xs font-semibold text-foreground">
            {item.valueLabel ?? item.value}
          </span>
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

function WrappedMetricValue({ value }: { value: string }) {
  return <span className="text-base leading-snug break-words">{value}</span>;
}

export function OperationsInsightsContent() {
  const orgId = useOrgId();

  const insightsQuery = useQuery({
    queryKey: ['admin-operations-insights', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/operations-insights', {
        headers: buildOrgHeaders(orgId),
      });
      const json = await readApiJson<{ data: OperationsInsights }>(
        res,
        '運用分析の取得に失敗しました',
      );
      return json.data;
    },
    enabled: !!orgId,
  });

  return (
    <PageScaffold variant="bare" testId="operations-insights-page">
      {/* SYS-3: 自前 section ヘッダを共通 AdminPageHeader へ。関連導線は supportingContent に。 */}
      <AdminPageHeader
        title="在宅業務の動きを見る"
        description="月ごとの訪問量と、直近30日の工程所要時間から、次に詰まりを確認する場所を絞ります。"
        supportingContent={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/capacity"
              className="rounded-md border border-border/70 px-3 py-2 text-sm font-medium text-primary hover:bg-muted"
            >
              キャパシティ
            </Link>
            <Link
              href="/admin/inventory-forecast"
              className="rounded-md border border-border/70 px-3 py-2 text-sm font-medium text-primary hover:bg-muted"
            >
              在庫予測
            </Link>
            <Link
              href="/admin/incidents"
              className="rounded-md border border-border/70 px-3 py-2 text-sm font-medium text-primary hover:bg-muted"
            >
              ヒヤリハット
            </Link>
          </div>
        }
      />

      {!orgId || insightsQuery.isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2" role="status" aria-label="運用分析読み込み中">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg xl:col-span-2" />
        </div>
      ) : insightsQuery.isError || !insightsQuery.data ? (
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <ErrorState
            variant="server"
            title="運用分析を表示できません"
            description="集計の取得に失敗しました。再試行してください。"
            onRetry={() => void insightsQuery.refetch()}
          />
        </div>
      ) : (
        <OperationsInsightsLoaded insights={insightsQuery.data} />
      )}
    </PageScaffold>
  );
}

function OperationsInsightsLoaded({ insights }: { insights: OperationsInsights }) {
  const summary = summarizeOperationsInsights({
    monthlyVisits: insights.monthly_visits,
    processes: insights.processes,
  });
  const deltaValue =
    summary.previousMonthDelta === null
      ? '比較なし'
      : summary.previousMonthDelta >= 0
        ? `+${summary.previousMonthDelta}`
        : `${summary.previousMonthDelta}`;
  const deltaUnit = summary.previousMonthDelta === null ? undefined : '件';
  const slowestText = summary.slowestProcess
    ? `${summary.slowestProcess.label} ${formatOperationDuration(
        summary.slowestProcess.averageMinutes,
      )}`
    : '実績なし';

  return (
    <>
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <div
          className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          data-testid="operations-insights-kpis"
        >
          <StatCard
            label={`${summary.currentMonthLabel}の訪問`}
            value={summary.currentMonthVisits.toLocaleString('ja-JP')}
            unit="件"
            hint="完了・再訪・配送のみを含む"
            className="h-full bg-background px-4 py-3 ring-0"
          />
          <StatCard
            label="前月差"
            value={deltaValue}
            unit={deltaUnit}
            hint="前月実績がある月だけ比較"
            className="h-full bg-background px-4 py-3 ring-0"
          />
          <StatCard
            label="最も時間がかかる工程"
            labelClassName="whitespace-normal leading-snug"
            value={<WrappedMetricValue value={slowestText} />}
            hint="直近30日の平均所要時間"
            className="h-full bg-background px-4 py-3 ring-0"
          />
          <StatCard
            label="次に見るところ"
            value={<WrappedMetricValue value={summary.nextFocus} />}
            hint={`${summary.activeProcessCount}工程に直近実績あり`}
            className="h-full bg-background px-4 py-3 ring-0"
          />
        </div>

        <div className="mt-4 rounded-md border border-border/70 bg-muted/25 p-3">
          <h2 className="text-sm font-bold text-foreground">改善のヒント</h2>
          {insights.hints.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              直近の実績が少ないため、ヒントはまだありません。
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 md:grid-cols-2" role="list">
              {insights.hints.map((hint) => (
                <li
                  key={hint}
                  className="rounded-md bg-background px-3 py-2 text-sm text-foreground"
                >
                  {hint}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

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
                valueLabel:
                  process.sampleCount > 0 ? formatOperationDuration(process.averageMinutes) : '0分',
                colorClass: PROCESS_COLORS[index % PROCESS_COLORS.length],
              }))}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            直近30日の平均所要分(作成から更新までの概算)
          </p>
        </section>
      </div>
    </>
  );
}
