'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { cn } from '@/lib/utils';
import type {
  BillingCheckMonth,
  BillingCheckResponse,
  BillingCheckReviewRow,
} from '@/types/billing-check';

/**
 * 11_billing の算定チェック(docs/design-gap-analysis-new.md)。
 * 本文(3 KPI → 疑義テーブル「根拠とセットでしか出さない」→ 摘要欄の自動生成注記)+
 * 右レール(次にやること / 止まっている理由 / 根拠・記録)の 2 カラム構成。
 * 主操作(青)は右レールの大ボタン 1 つに集約し、月トグルはチップ表現にとどめる。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

export async function fetchBillingCheck(
  orgId: string,
  month: BillingCheckMonth,
): Promise<BillingCheckResponse> {
  const res = await fetch(`/api/billing-evidence/check?month=${month}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('算定チェック集計の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

const MONTH_OPTIONS: Array<{ value: BillingCheckMonth; label: string }> = [
  { value: 'current', label: '今月' },
  { value: 'previous', label: '先月' },
];

/** 経過時間ラベル(「1日」「30分」)。 */
export const formatAgeLabel = formatElapsedLabel;

// ---------------------------------------------------------------------------
// 上部 KPI ストリップ
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  unit,
  valueClassName,
  bar,
  testId,
}: {
  label: string;
  value: number;
  unit: string;
  valueClassName?: string;
  bar: { className: string; percent: number } | null;
  testId: string;
}) {
  return (
    <article className="rounded-lg border border-border/70 bg-card p-4" data-testid={testId}>
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn('text-[28px] font-bold leading-9 tabular-nums', valueClassName)}>
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </p>
      <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        {bar ? (
          <div
            className={cn('h-full rounded-full', bar.className)}
            style={{ width: `${Math.min(Math.max(bar.percent, 0), 100)}%` }}
          />
        ) : null}
      </div>
    </article>
  );
}

function KpiStrip({ data }: { data: BillingCheckResponse }) {
  const checkedTotal = data.passed_count + data.review_count;
  const passedPercent = checkedTotal > 0 ? (data.passed_count / checkedTotal) * 100 : 0;
  const reviewPercent =
    checkedTotal > 0 ? Math.max((data.review_count / checkedTotal) * 100, 2) : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="billing-check-kpi-strip">
      <KpiCard
        label={`${data.month_short_label} 自動チェック`}
        value={data.passed_count}
        unit="件 合格"
        bar={{ className: 'bg-state-done', percent: passedPercent }}
        testId="billing-check-kpi-passed"
      />
      <KpiCard
        label="疑義(人の確認待ち)"
        value={data.review_count}
        unit="件"
        valueClassName="text-state-confirm"
        bar={
          data.review_count > 0 ? { className: 'bg-state-confirm', percent: reviewPercent } : null
        }
        testId="billing-check-kpi-review"
      />
      <KpiCard
        label="本日訪問の算定候補"
        value={data.today_pending_count}
        unit="件(訪問完了後に確定)"
        valueClassName="text-primary"
        bar={null}
        testId="billing-check-kpi-today"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 疑義テーブル(根拠とセットでしか出さない)
// ---------------------------------------------------------------------------

const reviewColumns: ColumnDef<BillingCheckReviewRow>[] = [
  {
    id: 'patient',
    header: '患者',
    cell: ({ row }) =>
      row.original.patient_href ? (
        <a href={row.original.patient_href} className="font-medium hover:underline">
          {row.original.patient_label}
        </a>
      ) : (
        <span className="font-medium">{row.original.patient_label}</span>
      ),
    meta: { label: '患者' },
  },
  {
    id: 'billing_name',
    header: '算定項目',
    cell: ({ row }) => row.original.billing_name,
    meta: { label: '算定項目' },
  },
  {
    id: 'confirm_text',
    header: '確認すること',
    cell: ({ row }) => <span className="leading-5">{row.original.confirm_text}</span>,
    meta: { label: '確認すること' },
  },
  {
    id: 'evidence',
    header: '根拠',
    cell: ({ row }) => (
      <a
        href={row.original.evidence_href}
        className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-tag-info/30 bg-tag-info/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-tag-info/15 sm:min-h-8"
      >
        {row.original.evidence_label} →
      </a>
    ),
    meta: { label: '根拠' },
  },
  {
    id: 'action',
    header: () => <span className="sr-only">戻り先</span>,
    cell: ({ row }) => (
      <a
        href={row.original.action_href}
        className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md border border-primary/30 bg-card px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 sm:min-h-8"
      >
        {row.original.action_label}
      </a>
    ),
    meta: { label: '戻り先' },
  },
];

function ReviewTableSection({ data }: { data: BillingCheckResponse }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="billing-check-review-heading"
      data-testid="billing-check-review-table"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id="billing-check-review-heading" className="text-base font-bold text-foreground">
          疑義 — 根拠とセットでしか出さない
        </h3>
        <p className="text-xs text-muted-foreground">
          自動チェックを通らなかったものだけが人に届きます
        </p>
      </div>
      {data.review_rows.length === 0 ? (
        <p className="mt-3 rounded-md border border-state-done/30 bg-state-done/10 px-3 py-2.5 text-sm text-state-done">
          疑義はありません — 自動チェックをすべて通過しています
        </p>
      ) : (
        <div className="mt-3">
          <DataTable
            columns={reviewColumns}
            data={data.review_rows}
            caption="算定チェック疑義一覧"
            getRowId={(row) => row.id}
            getRowA11yLabel={(row) => `${row.patient_label} / ${row.billing_name} / ${row.id}`}
            toolbar={{
              enableColumnVisibility: true,
            }}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function BillingCheckSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="算定チェック読み込み中">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function BillingCheckContent() {
  const orgId = useOrgId();
  const [month, setMonth] = useState<BillingCheckMonth>('current');
  const isBootstrappingOrg = !orgId;

  const checkQuery = useQuery({
    queryKey: ['billing-check', orgId, month],
    queryFn: () => fetchBillingCheck(orgId, month),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
  });

  const data = checkQuery.data ?? null;
  const blockedReasons: BlockedReason[] = (data?.rail.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category,
    ageLabel: formatAgeLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));
  const evidence: EvidenceItem[] = data
    ? [
        {
          id: 'rule-revision',
          label: '算定ルール版',
          meta: data.records.rule_revision_label,
          href: '/admin/billing-rules',
        },
        {
          id: 'rejection-history',
          label: '返戻履歴',
          meta: `直近${data.records.rejection_count}件`,
          href: '/billing/candidates',
        },
        {
          id: 'summary-templates',
          label: '摘要欄テンプレ',
          meta: `${data.records.summary_template_kind_count}種`,
          href: '/admin/document-templates',
        },
        {
          id: 'partner-cooperation',
          label: '薬局間協力',
          meta: '月次処理',
          href: '/billing/partner-cooperation',
        },
      ]
    : [];

  return (
    <section aria-label="算定チェック" data-testid="billing-check">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">算定チェック</h2>
          <p className="text-sm text-muted-foreground">
            {data
              ? `${data.month_label} — 合格${data.passed_count} / 疑義${data.review_count}`
              : '—'}
          </p>
        </div>
        <FilterChipBar
          options={MONTH_OPTIONS}
          value={month}
          onChange={setMonth}
          ariaLabel="対象月の切替"
        />
      </div>

      <div className="mt-4 xl:min-h-[calc(100dvh-10rem)]">
        {isBootstrappingOrg || checkQuery.isLoading ? (
          <BillingCheckSkeleton />
        ) : checkQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="算定チェックを表示できません"
              description="疑義と自動チェックの集計取得に失敗しました。再試行してください。"
              detail={checkQuery.error instanceof Error ? checkQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void checkQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <KpiStrip data={data} />
              <ReviewTableSection data={data} />
              <p
                className="rounded-md border border-tag-info/30 bg-tag-info/10 px-3 py-2.5 text-sm leading-6 text-tag-info"
                data-testid="billing-check-summary-note"
              >
                レセプト摘要欄の文言は算定項目から自動生成されます。手で書くのは「確認すること」列の事実確認だけです。
              </p>
            </div>
            <WorkspaceActionRail
              nextAction={{
                actionLabel: data.rail.next_action.label,
                description: data.rail.next_action.description,
                actionHref: data.rail.next_action.href,
              }}
              blockedReasons={blockedReasons}
              blockedReasonsEmptyLabel="止まっている作業はありません"
              evidence={evidence}
              evidenceOpenLabel="開く"
            />
          </div>
        )}
      </div>
    </section>
  );
}
