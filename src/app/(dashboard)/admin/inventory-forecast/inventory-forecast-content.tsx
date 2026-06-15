'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
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

// 警告 3 段階の規約内: 要発注=赤 / 発注候補=橙 / 余裕あり=中立グレー
const STATUS_BADGE_CLASSES: Record<DrugForecastStatus, string> = {
  order_required: 'border-red-200 bg-red-50 text-red-700',
  order_candidate: 'border-amber-200 bg-amber-50 text-amber-700',
  sufficient: 'border-border/70 bg-muted/40 text-muted-foreground',
};

function formatWeekLabel(week: InventoryForecast['week']): string {
  const format = (key: string) => {
    const [, month, day] = key.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  return `${format(week.start_date)}(月)〜${format(week.end_date)}(日)`;
}

function StatusBadge({ status }: { status: DrugForecastStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
    >
      {DRUG_FORECAST_STATUS_LABELS[status]}
    </span>
  );
}

function SummaryCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{caption}</p>
    </div>
  );
}

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
    <div className="space-y-5" data-testid="inventory-forecast-page">
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              在庫と定期処方の予測
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              対象期間: {formatWeekLabel(forecast.week)}
              。来週の訪問予定と直近の定期処方から、不足側の薬と影響患者を先に確認します。
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">次にすること</p>
            <p className="mt-1 text-base font-bold text-foreground">{summary.nextAction}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="要発注"
            value={`${summary.orderRequiredCount}件`}
            caption="在庫が必要見込みの半分未満"
          />
          <SummaryCard
            label="発注候補"
            value={`${summary.orderCandidateCount}件`}
            caption="来週必要量に対して在庫不足"
          />
          <SummaryCard
            label="影響患者"
            value={`${summary.affectedPatientCount}件`}
            caption="不足側の薬を使う訪問予定"
          />
          <SummaryCard
            label="最優先"
            value={summary.priorityDrug?.drugKey ?? '不足なし'}
            caption={
              summary.priorityDrug
                ? `充足率 ${coveragePercent(summary.priorityDrug)}%`
                : '現時点では通常確認'
            }
          />
        </div>
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
            <div className="mt-4 overflow-x-auto rounded-md border border-border/70">
              <table
                className="w-full min-w-[480px] text-sm"
                data-testid="inventory-forecast-table"
              >
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      薬剤
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      必要見込み
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      在庫
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      充足率
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      対応
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.drugs.map((drug) => (
                    <tr key={drug.drugKey} className="border-b border-border/50 last:border-b-0">
                      <td className="px-4 py-3 font-medium text-foreground">{drug.drugKey}</td>
                      <td className="px-4 py-3 text-foreground">
                        {drug.requiredQty}
                        {drug.unit}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {drug.stockQty}
                        {drug.unit}
                      </td>
                      <td className="px-4 py-3 text-foreground">{coveragePercent(drug)}%</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={drug.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                      {patient.firstVisitDateKey.slice(5).replace('-', '/')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
