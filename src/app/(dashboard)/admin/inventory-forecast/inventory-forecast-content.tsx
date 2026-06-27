'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  DRUG_FORECAST_STATUS_LABELS,
  coveragePercent,
  summarizeInventoryForecast,
  type AffectedPatientCard,
  type DrugForecastRow,
  type DrugForecastStatus,
} from '@/lib/analytics/inventory-forecast';

/**
 * p1_07「在庫と定期処方の予測」: 来週(翌週月〜日)の訪問予定と定期処方から
 * 薬剤別の必要量見込みを在庫と突合し、不足側の薬剤と影響患者を一覧する。
 */

type InventoryForecast = {
  week: { start_date: string; end_date: string };
  drugs: DrugForecastRow[];
  patients: AffectedPatientCard[];
};

// 警告 3 段階の規約内: 要発注=blocked(赤) / 発注候補=confirm(橙) / 余裕あり=中立(既定 Badge)
const STATUS_ROLE: Record<DrugForecastStatus, StatusRole | 'neutral'> = {
  order_required: 'blocked',
  order_candidate: 'confirm',
  sufficient: 'neutral',
};

function formatWeekLabel(week: InventoryForecast['week']): string {
  const format = (key: string) => {
    const [, month, day] = key.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  return `${format(week.start_date)}(月)〜${format(week.end_date)}(日)`;
}

function StatusBadge({ status }: { status: DrugForecastStatus }) {
  const role = STATUS_ROLE[status];
  if (role === 'neutral') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {DRUG_FORECAST_STATUS_LABELS[status]}
      </Badge>
    );
  }
  return <StateBadge role={role}>{DRUG_FORECAST_STATUS_LABELS[status]}</StateBadge>;
}

const drugForecastColumns: ColumnDef<DrugForecastRow>[] = [
  {
    accessorKey: 'drugKey',
    header: '薬剤',
    cell: ({ row }) => <span className="font-medium">{row.original.drugKey}</span>,
    meta: { label: '薬剤' },
  },
  {
    id: 'requiredQty',
    accessorFn: (row) => `${row.requiredQty}${row.unit}`,
    header: '必要見込み',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.requiredQty}
        {row.original.unit}
      </span>
    ),
    meta: { label: '必要見込み' },
  },
  {
    id: 'stockQty',
    accessorFn: (row) => `${row.stockQty}${row.unit}`,
    header: '在庫',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.stockQty}
        {row.original.unit}
      </span>
    ),
    meta: { label: '在庫' },
  },
  {
    id: 'coverage',
    accessorFn: (row) => coveragePercent(row),
    header: '充足率',
    cell: ({ row }) => <span className="tabular-nums">{coveragePercent(row.original)}%</span>,
    meta: { label: '充足率' },
  },
  {
    id: 'status',
    accessorFn: (row) => DRUG_FORECAST_STATUS_LABELS[row.status],
    header: '対応',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    meta: { label: '対応' },
  },
];

export function InventoryForecastContent() {
  const orgId = useOrgId();

  const forecastQuery = useQuery({
    queryKey: ['admin-inventory-forecast', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/inventory-forecast', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('在庫予測の取得に失敗しました');
      const json = await res.json();
      return json.data as InventoryForecast;
    },
    enabled: !!orgId,
  });

  if (!orgId || forecastQuery.isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-5" role="status" aria-label="在庫予測読み込み中">
        <Skeleton className="h-80 w-full rounded-lg xl:col-span-3" />
        <Skeleton className="h-80 w-full rounded-lg xl:col-span-2" />
      </div>
    );
  }

  if (forecastQuery.isError || !forecastQuery.data) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="在庫予測を表示できません"
          description="集計の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void forecastQuery.refetch() }}
        />
      </div>
    );
  }

  const forecast = forecastQuery.data;
  const summary = summarizeInventoryForecast({
    drugs: forecast.drugs,
    patients: forecast.patients,
  });

  return (
    <PageScaffold variant="bare" testId="inventory-forecast-page">
      {/* SYS-3: 自前 section ヘッダを共通 AdminPageHeader へ。次にすること は supportingContent に。 */}
      <AdminPageHeader
        title="在庫と定期処方の予測"
        description={`対象期間: ${formatWeekLabel(forecast.week)}。来週の訪問予定と直近の定期処方から、不足側の薬と影響患者を先に確認します。`}
        supportingContent={
          <div className="rounded-md border border-border/70 bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">次にすること</p>
            <p className="mt-1 text-base font-bold text-foreground">{summary.nextAction}</p>
          </div>
        }
      />
      {/* 共通 StatCard へ統一(card-in-card を避け bare grid)。状態色は意味のある時のみ(0件は中立)。 */}
      <section aria-label="在庫予測サマリー" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="要発注"
          value={summary.orderRequiredCount.toLocaleString('ja-JP')}
          unit="件"
          role={summary.orderRequiredCount > 0 ? 'blocked' : undefined}
          hint="在庫が必要見込みの半分未満"
        />
        <StatCard
          label="発注候補"
          value={summary.orderCandidateCount.toLocaleString('ja-JP')}
          unit="件"
          role={summary.orderCandidateCount > 0 ? 'confirm' : undefined}
          hint="来週必要量に対して在庫不足"
        />
        <StatCard
          label="影響患者"
          value={summary.affectedPatientCount.toLocaleString('ja-JP')}
          unit="件"
          hint="不足側の薬を使う訪問予定"
        />
        <StatCard
          label="最優先"
          // 薬剤ベース名は数値でないため、長名でも溢れないよう小さめ・折返し可で描く(StatCard 本体は不変)。
          value={
            <span className="text-base leading-snug break-words">
              {summary.priorityDrug?.drugKey ?? '不足なし'}
            </span>
          }
          role={
            summary.priorityDrug?.status === 'order_required'
              ? 'blocked'
              : summary.priorityDrug
                ? 'confirm'
                : undefined
          }
          hint={
            summary.priorityDrug
              ? `充足率 ${coveragePercent(summary.priorityDrug)}%`
              : '現時点では通常確認'
          }
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <section
          className="rounded-lg border border-border/70 bg-card p-4 xl:col-span-3"
          aria-labelledby="inventory-forecast-drugs-heading"
        >
          <h2 id="inventory-forecast-drugs-heading" className="text-sm font-bold text-foreground">
            来週必要になりそうな薬
          </h2>
          {forecast.drugs.length === 0 ? (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              来週の訪問予定と在庫登録から計算できる薬剤がありません。
            </p>
          ) : (
            <div className="mt-4" data-testid="inventory-forecast-table">
              <DataTable
                columns={drugForecastColumns}
                data={forecast.drugs}
                caption="来週必要になりそうな薬"
                getRowId={(row) => row.drugKey}
                getRowA11yLabel={(row) =>
                  `${row.drugKey} ${DRUG_FORECAST_STATUS_LABELS[row.status]}`
                }
                emptyMessage="来週の訪問予定と在庫登録から計算できる薬剤がありません。"
                toolbar={{
                  enableGlobalFilter: true,
                  globalFilterPlaceholder: '薬剤別必要量内検索',
                  enableColumnVisibility: true,
                }}
              />
            </div>
          )}
        </section>

        <section
          className="rounded-lg border border-border/70 bg-card p-4 xl:col-span-2"
          aria-labelledby="inventory-forecast-patients-heading"
        >
          <h2
            id="inventory-forecast-patients-heading"
            className="text-sm font-bold text-foreground"
          >
            影響する患者さん
          </h2>
          {forecast.patients.length === 0 ? (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              不足見込みの薬剤を使う来週訪問予定の患者さんはいません。
            </p>
          ) : (
            <ul className="mt-4 space-y-3" role="list">
              {forecast.patients.map((patient) => (
                <li
                  key={patient.key}
                  className="rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{patient.label} 様</p>
                      <p className="mt-1 text-xs text-muted-foreground">次回処方予定あり</p>
                    </div>
                    {/* AffectedPatientCard は来週初回訪問日のみ保持。薬切れ予定日/緊急度の真値は
                        持たないため、捏造せず「訪問予定 M/D」と明示する(緊急度バッジは出さない)。 */}
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                      訪問予定 {patient.firstVisitDateKey.slice(5).replace('-', '/')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageScaffold>
  );
}
