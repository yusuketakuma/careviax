'use client';

import { useQuery } from '@tanstack/react-query';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminCapacityShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StatCard } from '@/components/ui/stat-card';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { CapacityProcessKey } from '@/lib/analytics/capacity';

/**
 * KPI が閾値を超えたときだけ付ける状態(点表示)。未超過は null=中立にして、
 * KPI 値そのものは色で状態を誤伝しないようにする(plan「KPIが状態を誤伝しない」)。
 */
export type CapacityKpiState = { role: 'confirm' | 'blocked'; label: string } | null;

/** スタッフ稼働率: 100%以上=過負荷(blocked) / 85%以上=逼迫(confirm) / 未満=中立。 */
export function staffUtilizationState(percent: number): CapacityKpiState {
  if (percent >= 100) return { role: 'blocked', label: '過負荷' };
  if (percent >= 85) return { role: 'confirm', label: '逼迫' };
  return null;
}

/** 緊急余力(件): 0以下=余力なし(blocked) / 2未満=余力僅少(confirm) / 以上=中立。 */
export function emergencyCapacityState(count: number): CapacityKpiState {
  if (count <= 0) return { role: 'blocked', label: '余力なし' };
  if (count < 2) return { role: 'confirm', label: '余力僅少' };
  return null;
}

/**
 * p0_45「キャパシティ・詰まり確認」: 今日あとどれだけ対応できるかを
 * KPI 4 枚(訪問枠 / 調剤・セット / スタッフ稼働 / 緊急余力)と
 * 行程ごとの残り・スタッフ別の負荷(CSS バー)+ 今すぐ見るべきことで示す。
 */

type CapacitySummary = {
  generated_at: string;
  kpis: {
    visit_slots: { completed: number; total: number };
    dispense_set: { completed: number; total: number };
    staff_utilization_percent: number;
    emergency_capacity_count: number;
  };
  process_remaining: Array<{ key: CapacityProcessKey; label: string; count: number }>;
  staff_load: Array<{ user_id: string; label: string; load_percent: number }>;
  attention_items: string[];
};

// 行程バーの系列色。状態色ではなくデータ可視化の系列なので --chart-* トークンを使う。
const PROCESS_COLORS: Record<CapacityProcessKey, string> = {
  input: 'bg-chart-1',
  confirm: 'bg-chart-3',
  dispense: 'bg-chart-1',
  set: 'bg-chart-5',
  visit: 'bg-chart-2',
  report: 'bg-chart-4',
};

// スタッフバーの系列色(--chart-* トークンを繰り返し使用)。
const STAFF_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-5', 'bg-chart-4'];

// KPI 進捗バーは状態色ではなく中立色で統一し、閾値超過は role dot + label で表す。
const KPI_PROGRESS_CLASS = 'bg-muted-foreground/45';

/** 緊急余力バーのフルスケール(10件で満タン表示) */
const EMERGENCY_BAR_FULL_SCALE = 10;

function CapacityKpiCard({
  label,
  value,
  percent,
  state = null,
}: {
  label: string;
  value: string;
  percent: number;
  /** 閾値超過時のみ点表示する状態。null は中立(状態色なし)。 */
  state?: CapacityKpiState;
}) {
  return (
    <StatCard
      label={label}
      labelElement="h2"
      labelClassName="text-sm"
      value={value}
      valueClassName="whitespace-nowrap text-xl text-foreground sm:text-2xl"
      role={state?.role}
      roleLabel={state?.label}
      showRoleLabel={!!state}
      progress={{ percent, className: KPI_PROGRESS_CLASS }}
      className="rounded-lg p-3 sm:p-4"
    />
  );
}

function BarChart({
  items,
  ariaLabel,
  formatTitle,
}: {
  items: Array<{ label: string; value: number; colorClass: string }>;
  ariaLabel: string;
  /** 各バーのホバー title(単位つき)。値ラベルに加えてポインタでも値を確認できるようにする。 */
  formatTitle: (item: { label: string; value: number }) => string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="flex h-56 items-end gap-3 px-2" role="img" aria-label={ariaLabel}>
      {items.map((item) => (
        <div
          key={item.label}
          title={formatTitle(item)}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="text-xs font-semibold text-foreground">{item.value}</span>
          <div
            className={`w-full rounded-md ${item.colorClass}`}
            style={{ height: `${Math.max((item.value / max) * 78, 2)}%` }}
          />
          <span className="truncate text-[11px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 完了/全体 の割合(全体 0 件は 0%)。 */
function ratioPercent(completed: number, total: number): number {
  return total > 0 ? (completed / total) * 100 : 0;
}

export function CapacityContent() {
  const orgId = useOrgId();

  const capacityQuery = useQuery({
    queryKey: ['admin-capacity', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/capacity', {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('キャパシティの取得に失敗しました');
      const json = await res.json();
      return json.data as CapacitySummary;
    },
    enabled: !!orgId,
  });

  if (!orgId || capacityQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="キャパシティ読み込み中">
        <div
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          data-testid="capacity-loading-kpis"
        >
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        {/* loaded レイアウト(KPI → 今すぐ見るべきこと → 2 チャート)に合わせ、
            load 時の section 順・幅ジャンプを防ぐ。 */}
        <div data-testid="capacity-loading-attention">
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2" data-testid="capacity-loading-charts">
          <Skeleton className="h-80 w-full rounded-lg" />
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (capacityQuery.isError || !capacityQuery.data) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="キャパシティを表示できません"
          description="集計の取得に失敗しました。再試行してください。"
          onRetry={() => void capacityQuery.refetch()}
        />
      </div>
    );
  }

  const { kpis, process_remaining, staff_load, attention_items } = capacityQuery.data;

  return (
    <PageScaffold variant="bare" testId="capacity-page">
      {/* SYS-3: 自前 div+h1+ショートカットを共通 PageScaffold + AdminPageHeader へ統一。 */}
      <AdminPageHeader
        title="今日あとどれだけ対応できる?"
        description="訪問枠・調剤セット・スタッフ稼働・緊急余力から、今日あと対応できる量と詰まりを確認します。"
        shortcuts={getAdminCapacityShortcutLinks()}
        supportingContent={null}
      />

      {/* KPI 4 枚: 訪問枠 / 調剤・セット / スタッフ稼働 / 緊急余力 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="capacity-kpis">
        {/* 訪問枠・調剤セットは進捗(完了/全体)で、時刻文脈なしの閾値警告は誤シグナルになるため中立。 */}
        <CapacityKpiCard
          label="訪問枠"
          value={`${kpis.visit_slots.completed} / ${kpis.visit_slots.total}件`}
          percent={ratioPercent(kpis.visit_slots.completed, kpis.visit_slots.total)}
        />
        <CapacityKpiCard
          label="調剤・セット"
          value={`${kpis.dispense_set.completed} / ${kpis.dispense_set.total}件`}
          percent={ratioPercent(kpis.dispense_set.completed, kpis.dispense_set.total)}
        />
        <CapacityKpiCard
          label="スタッフ稼働"
          value={`${kpis.staff_utilization_percent}%`}
          percent={kpis.staff_utilization_percent}
          state={staffUtilizationState(kpis.staff_utilization_percent)}
        />
        <CapacityKpiCard
          label="緊急余力"
          value={`${kpis.emergency_capacity_count.toFixed(1)}件`}
          percent={(kpis.emergency_capacity_count / EMERGENCY_BAR_FULL_SCALE) * 100}
          state={emergencyCapacityState(kpis.emergency_capacity_count)}
        />
      </div>

      {/* 即時判断情報を主要データ(チャート)より上へ昇格。UI/UX SSOT §2 の情報順
          (1 目的/即時アクション → 2 今すぐ対応が必要な情報 → 3 主要データ) と L117
          (即時判断情報は本文側に目立たせる) に合わせ、KPI 直下のフル幅 section にする。 */}
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">今すぐ見るべきこと</h2>
        {attention_items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">いま注意が必要な詰まりはありません。</p>
        ) : (
          <ul className="mt-3 space-y-2.5" role="list">
            {attention_items.map((item) => (
              <li key={item} className="text-sm leading-6 text-foreground">
                ・{item}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-border/70 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">行程ごとの残り</h2>
          <div className="mt-4">
            <BarChart
              ariaLabel="行程ごとの残り件数"
              formatTitle={(item) => `${item.label}: 残り${item.value}件`}
              items={process_remaining.map((process) => ({
                label: process.label,
                value: process.count,
                colorClass: PROCESS_COLORS[process.key],
              }))}
            />
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">スタッフ別の負荷</h2>
          {staff_load.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">勤務中のスタッフがいません。</p>
          ) : (
            <div className="mt-4">
              <BarChart
                ariaLabel="スタッフ別の負荷(%)"
                formatTitle={(item) => `${item.label}: ${item.value}%`}
                items={staff_load.map((staff, index) => ({
                  label: staff.label,
                  value: staff.load_percent,
                  colorClass: STAFF_COLORS[index % STAFF_COLORS.length],
                }))}
              />
            </div>
          )}
        </section>
      </div>
    </PageScaffold>
  );
}
