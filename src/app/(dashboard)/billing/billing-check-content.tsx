'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { buildDailyOpsBlockedReasons } from '@/lib/workspace/daily-ops-rail';
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
    headers: buildOrgHeaders(orgId),
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

function KpiStrip({ data }: { data: BillingCheckResponse }) {
  const checkedTotal = data.passed_count + data.review_count;
  const passedPercent = checkedTotal > 0 ? (data.passed_count / checkedTotal) * 100 : 0;
  const reviewPercent =
    checkedTotal > 0 ? Math.max((data.review_count / checkedTotal) * 100, 2) : 0;

  return (
    <div className="grid gap-2 sm:grid-cols-3 sm:gap-3" data-testid="billing-check-kpi-strip">
      <div data-testid="billing-check-kpi-passed">
        <StatCard
          label={`${data.month_short_label} 自動チェック`}
          labelClassName="text-foreground"
          value={data.passed_count}
          unit="件 合格"
          progress={{ className: 'bg-state-done', percent: passedPercent }}
          className="h-full sm:p-4"
        />
      </div>
      <div data-testid="billing-check-kpi-review">
        <StatCard
          label="疑義(人の確認待ち)"
          labelClassName="text-foreground"
          value={data.review_count}
          unit="件"
          valueClassName={data.review_count > 0 ? 'text-state-confirm' : undefined}
          progress={
            data.review_count > 0
              ? { className: 'bg-state-confirm', percent: reviewPercent }
              : { percent: 0 }
          }
          className="h-full sm:p-4"
        />
      </div>
      <div data-testid="billing-check-kpi-today">
        <StatCard
          label="本日訪問の算定候補"
          labelClassName="text-foreground"
          value={data.today_pending_count}
          unit="件(訪問完了後に確定)"
          valueClassName="text-primary"
          progress={{ percent: 0 }}
          className="h-full sm:p-4"
        />
      </div>
    </div>
  );
}

function BillingPrimaryStrip({
  data,
  blockedReasons,
  evidence,
}: {
  data: BillingCheckResponse;
  blockedReasons: BlockedReason[];
  evidence: EvidenceItem[];
}) {
  const primaryBlockedReason = blockedReasons[0] ?? null;

  return (
    <section
      aria-label="算定チェックの次アクション"
      className="grid gap-3 rounded-lg border border-border/70 bg-card p-3 md:grid-cols-[1.05fr_0.95fr_0.9fr] md:p-4"
      data-testid="billing-primary-strip"
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          次にやること
        </p>
        <Button asChild className="min-h-[44px] w-full justify-start sm:h-11 sm:min-h-[44px]">
          <a href={data.rail.next_action.href}>{data.rail.next_action.label}</a>
        </Button>
        <p className="text-sm leading-5 text-muted-foreground">
          {data.rail.next_action.description}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          止まっている理由
        </p>
        {primaryBlockedReason ? (
          <div
            className={cn(
              'rounded-md border p-3',
              primaryBlockedReason.severity === 'critical'
                ? 'border-destructive/30 bg-destructive/10'
                : 'border-state-confirm/30 bg-state-confirm/10',
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {primaryBlockedReason.categoryLabel ? (
                <span className="rounded bg-background px-1.5 py-0.5 font-medium text-foreground">
                  {primaryBlockedReason.categoryLabel}
                </span>
              ) : null}
              {primaryBlockedReason.ageLabel ? (
                <span className="text-muted-foreground">{primaryBlockedReason.ageLabel}</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-medium leading-5 text-foreground">
              {primaryBlockedReason.label}
            </p>
            {primaryBlockedReason.actionHref && primaryBlockedReason.actionLabel ? (
              <a
                href={primaryBlockedReason.actionHref}
                className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline"
              >
                {primaryBlockedReason.actionLabel}
              </a>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border-l-4 border-border/70 border-l-state-done bg-card px-3 py-2.5 text-sm text-state-done">
            止まっている作業はありません
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          根拠・記録
        </p>
        <p className="text-sm leading-5 text-muted-foreground md:hidden">
          {evidence
            .slice(0, 3)
            .map((item) => `${item.label}${item.meta ? ` ${item.meta}` : ''}`)
            .join(' / ')}
        </p>
        <ul className="hidden flex-wrap gap-2 md:flex" role="list">
          {evidence.slice(0, 3).map((item) => (
            <li key={item.id} className="min-w-0">
              {item.href ? (
                <a
                  href={item.href}
                  className="inline-flex min-h-[44px] min-w-[44px] max-w-full items-center gap-2 rounded-md border border-border/70 px-3 py-1 text-sm hover:bg-muted/60"
                >
                  <span className="min-w-0 truncate text-foreground">{item.label}</span>
                  {item.meta ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
                  ) : null}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
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
        <a
          href={row.original.patient_href}
          className="inline-flex min-h-[44px] items-center font-medium hover:underline"
        >
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
        className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-tag-info/30 bg-tag-info/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-tag-info/15"
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
        className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md border border-primary/30 bg-card px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5"
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
        <p className="mt-3 rounded-md border-l-4 border-border/70 border-l-state-done bg-card px-3 py-2.5 text-sm text-state-done">
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
  const blockedReasons: BlockedReason[] = buildDailyOpsBlockedReasons(data?.rail ?? null);
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
          <h1 className="text-xl font-bold text-foreground">算定チェック</h1>
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
              onRetry={() => void checkQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <BillingPrimaryStrip
                data={data}
                blockedReasons={blockedReasons}
                evidence={evidence}
              />
              <ReviewTableSection data={data} />
              <KpiStrip data={data} />
              <p
                className="rounded-md border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-2.5 text-sm leading-6 text-tag-info"
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
