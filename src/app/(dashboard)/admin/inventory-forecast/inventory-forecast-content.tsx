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
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  DRUG_FORECAST_STATUS_LABELS,
  coveragePercent,
  summarizeInventoryForecast,
  type AffectedPatientCard,
  type DrugForecastRow,
  type DrugForecastStatus,
  type InventoryForecastRunOutBasis,
  type InventoryForecastUrgency,
  type UnresolvedDrugForecastRow,
} from '@/lib/analytics/inventory-forecast';

/**
 * p1_07「在庫と定期処方の予測」: 来週(翌週月〜日)の訪問予定と定期処方から
 * 薬剤別の必要量見込みを在庫と突合し、不足または在庫登録確認が必要な薬剤と影響患者を一覧する。
 */

type InventoryForecast = {
  week: { start_date: string; end_date: string };
  drugs: DrugForecastRow[];
  patients: AffectedPatientCard[];
  unresolvedDrugs?: UnresolvedDrugForecastRow[];
};

// 警告 3 段階の規約内: 要発注=blocked(赤) / 発注候補=confirm(橙) / 余裕あり=中立(既定 Badge)
const STATUS_ROLE: Record<DrugForecastStatus, StatusRole | 'neutral'> = {
  order_required: 'blocked',
  order_candidate: 'confirm',
  sufficient: 'neutral',
};

// 緊急度 → 6 軸トークン: 至急=blocked(赤) / 要注意=confirm(橙) / 通常=neutral / 不明=readonly。
// critical/warning のみアクションが要るので左ボーダー帯 + ラベルで示し、normal/unknown は色を付けない。
const URGENCY_ROLE: Record<InventoryForecastUrgency, StatusRole | 'neutral'> = {
  critical: 'blocked',
  warning: 'confirm',
  normal: 'neutral',
  unknown: 'readonly',
};

const URGENCY_LABEL: Record<InventoryForecastUrgency, string> = {
  critical: '至急',
  warning: '要注意',
  normal: '通常',
  unknown: '予定日不明',
};

const URGENCY_BORDER: Record<InventoryForecastUrgency, string> = {
  critical: 'border-l-4 border-l-state-blocked',
  warning: 'border-l-4 border-l-state-confirm',
  normal: '',
  unknown: '',
};

const UNRESOLVED_REASON_LABEL: Record<UnresolvedDrugForecastRow['reason'], string> = {
  missing_code: 'コード未登録',
  code_not_found: 'マスター未一致',
  ambiguous_code: '候補複数',
};

function formatMonthDay(dateKey: string): string {
  return dateKey.slice(5).replace('-', '/');
}

/** 薬切れ見込み日を basis に応じて忠実に表記する（推定は明示、根拠なしは捏造しない）。 */
function formatRunOut(runOutDateKey: string | null, basis: InventoryForecastRunOutBasis): string {
  if (runOutDateKey == null) return '薬切れ見込み日: 算出不可（処方期間情報なし）';
  if (basis === 'line_start_date_plus_days') {
    return `薬切れ見込み ${formatMonthDay(runOutDateKey)}（処方日数から推定）`;
  }
  return `薬切れ見込み ${formatMonthDay(runOutDateKey)}`;
}

function formatWeekLabel(week: InventoryForecast['week']): string {
  const format = (key: string) => {
    const [, month, day] = key.split('-');
    return `${Number(month)}/${Number(day)}`;
  };
  return `${format(week.start_date)}(月)〜${format(week.end_date)}(日)`;
}

function StatusBadge({ row }: { row: DrugForecastRow }) {
  if (!row.stockRegistered) {
    return <StateBadge role="confirm">登録確認</StateBadge>;
  }
  const status = row.status;
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

function UrgencyBadge({ urgency }: { urgency: InventoryForecastUrgency }) {
  const role = URGENCY_ROLE[urgency];
  if (role === 'neutral') return null; // 通常はバッジを出さない（状態色の塗り過ぎを避ける）
  if (urgency === 'unknown') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {URGENCY_LABEL[urgency]}
      </Badge>
    );
  }
  return <StateBadge role={role}>{URGENCY_LABEL[urgency]}</StateBadge>;
}

function forecastStatusLabel(row: DrugForecastRow): string {
  return row.stockRegistered ? DRUG_FORECAST_STATUS_LABELS[row.status] : '登録確認';
}

const drugForecastColumns: ColumnDef<DrugForecastRow>[] = [
  {
    accessorKey: 'drugKey',
    header: '薬剤',
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{row.original.drugKey}</span>
        {row.original.drugCode ? (
          <span className="text-xs text-muted-foreground">{row.original.drugCode}</span>
        ) : null}
      </span>
    ),
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
    accessorFn: (row) => (row.stockRegistered ? `${row.stockQty}${row.unit}` : '未登録'),
    header: '在庫',
    cell: ({ row }) => (
      <span className="flex flex-col gap-1">
        {row.original.stockRegistered ? (
          <span className="tabular-nums">
            {row.original.stockQty}
            {row.original.unit}
          </span>
        ) : (
          <span className="text-muted-foreground">未登録</span>
        )}
        {!row.original.stockRegistered ? <StateBadge role="confirm">在庫未登録</StateBadge> : null}
      </span>
    ),
    meta: { label: '在庫' },
  },
  {
    id: 'coverage',
    accessorFn: (row) => (row.stockRegistered ? coveragePercent(row) : '未確認'),
    header: '充足率',
    cell: ({ row }) =>
      row.original.stockRegistered ? (
        <span className="tabular-nums">{coveragePercent(row.original)}%</span>
      ) : (
        <span className="text-muted-foreground">未確認</span>
      ),
    meta: { label: '充足率' },
  },
  {
    id: 'status',
    accessorFn: forecastStatusLabel,
    header: '対応',
    cell: ({ row }) => <StatusBadge row={row.original} />,
    meta: { label: '対応' },
  },
];

export function InventoryForecastContent() {
  const orgId = useOrgId();

  const forecastQuery = useQuery({
    queryKey: ['admin-inventory-forecast', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/inventory-forecast', {
        headers: buildOrgHeaders(orgId),
      });
      const json = await readApiJson<{ data: InventoryForecast }>(
        res,
        '在庫予測の取得に失敗しました',
      );
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
          onRetry={() => void forecastQuery.refetch()}
        />
      </div>
    );
  }

  const forecast = forecastQuery.data;
  const unresolvedDrugs = forecast.unresolvedDrugs ?? [];
  const summary = summarizeInventoryForecast({
    drugs: forecast.drugs,
    patients: forecast.patients,
  });

  return (
    <PageScaffold variant="bare" testId="inventory-forecast-page">
      {/* SYS-3: 自前 section ヘッダを共通 AdminPageHeader へ。次にすること は supportingContent に。 */}
      <AdminPageHeader
        title="在庫と定期処方の予測"
        description={`対象期間: ${formatWeekLabel(forecast.week)}。来週の訪問予定と直近の定期処方から、不足または在庫登録確認が必要な薬と影響患者を先に確認します。`}
        supportingContent={
          <div className="rounded-md border border-border/70 bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">次にすること</p>
            <p className="mt-1 text-base font-bold text-foreground">{summary.nextAction}</p>
          </div>
        }
      />
      {/* 共通 StatCard へ統一(card-in-card を避け bare grid)。状態色は意味のある時のみ(0件は中立)。 */}
      <section aria-label="在庫予測サマリー" className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="在庫登録確認"
          value={summary.stockRegistrationReviewCount.toLocaleString('ja-JP')}
          unit="件"
          role={summary.stockRegistrationReviewCount > 0 ? 'confirm' : undefined}
          hint="採用在庫レコード未登録"
        />
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
          hint="不足または在庫登録確認が必要"
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
            summary.priorityDrug && !summary.priorityDrug.stockRegistered
              ? 'confirm'
              : summary.priorityDrug?.status === 'order_required'
                ? 'blocked'
                : summary.priorityDrug
                  ? 'confirm'
                  : undefined
          }
          hint={
            summary.priorityDrug
              ? summary.priorityDrug.stockRegistered
                ? `充足率 ${coveragePercent(summary.priorityDrug)}%`
                : '採用在庫レコード未登録'
              : '現時点では通常確認'
          }
        />
      </section>

      {unresolvedDrugs.length > 0 ? (
        <section
          className="rounded-lg border border-state-confirm/40 bg-state-confirm/5 p-4"
          aria-labelledby="inventory-forecast-unresolved-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="inventory-forecast-unresolved-heading"
                className="text-sm font-bold text-foreground"
              >
                コード未解決の処方需要
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                自動発注判定から分離しています。医薬品マスターのコード確認後に在庫と照合してください。
              </p>
            </div>
            <StateBadge role="confirm">{unresolvedDrugs.length}件 要確認</StateBadge>
          </div>
          <ul className="mt-4 divide-y divide-border/70" role="list">
            {unresolvedDrugs.map((drug) => (
              <li
                key={drug.drugIdentityKey}
                className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{drug.drugKey}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {UNRESOLVED_REASON_LABEL[drug.reason]}
                    {drug.drugCode ? `: ${drug.drugCode}` : ''}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground md:text-right">
                  <span className="font-medium text-foreground">
                    {drug.requiredQty}
                    {drug.unit}
                  </span>
                  <span className="ml-2">{drug.affectedPatientCount}名分</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                getRowId={(row) => row.drugIdentityKey}
                getRowA11yLabel={(row) => `${row.drugKey} ${forecastStatusLabel(row)}`}
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
              不足または在庫登録確認が必要な薬剤を使う来週訪問予定の患者さんはいません。
            </p>
          ) : (
            <ul className="mt-4 space-y-3" role="list">
              {forecast.patients.map((patient) => {
                const detailKeys =
                  patient.shortageDetails.length > 0
                    ? patient.shortageDetails
                    : patient.shortageDrugKeys.map((drugKey) => ({
                        drugKey,
                        stockRegistered: true,
                      }));
                const registeredShortageKeys = detailKeys
                  .filter((detail) => detail.stockRegistered)
                  .map((detail) => detail.drugKey);
                const unregisteredStockKeys = detailKeys
                  .filter((detail) => !detail.stockRegistered)
                  .map((detail) => detail.drugKey);

                return (
                  <li
                    key={patient.key}
                    className={`rounded-lg border border-border/70 bg-background px-4 py-3 ${URGENCY_BORDER[patient.urgency]}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{patient.label} 様</p>
                        {/* 施設バッチは「ラベル人数のうち実際に不足/在庫登録確認と判定できた人数」を明示し、
                          全員を評価済みと誤認させない。個人カードは処方予定の有無のみ。 */}
                        {patient.isFacilityBatch && patient.facilityPatientCount != null ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {patient.facilityPatientCount}名中 {patient.shortagePatientCount}
                            名に不足/在庫登録確認
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">次回処方予定あり</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <UrgencyBadge urgency={patient.urgency} />
                        <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                          訪問予定 {formatMonthDay(patient.firstVisitDateKey)}
                        </span>
                      </div>
                    </div>
                    {/* 薬切れ見込み日は basis(処方終了日 / 開始日+日数推定 / 不明)に忠実。捏造しない。 */}
                    <p
                      className={`mt-2 text-xs ${
                        patient.urgency === 'critical'
                          ? 'text-state-blocked'
                          : patient.urgency === 'warning'
                            ? 'text-state-confirm'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {formatRunOut(patient.runOutDateKey, patient.runOutBasis)}
                    </p>
                    {registeredShortageKeys.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        不足薬: {registeredShortageKeys.join('・')}
                      </p>
                    ) : null}
                    {unregisteredStockKeys.length > 0 ? (
                      <p className="mt-1 text-xs text-state-confirm">
                        在庫登録未確認: {unregisteredStockKeys.join('・')}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PageScaffold>
  );
}
