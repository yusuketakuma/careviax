'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FilterChipBar,
  type FilterChipOption,
} from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { PROCESS_STEPS_9 } from '@/lib/prescription/cycle-workspace';
import {
  buildDailyOpsBlockedReasons,
  buildDailyOpsNextAction,
} from '@/lib/workspace/daily-ops-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  INTAKE_ACTION_PRESENTATIONS,
  INTAKE_LANE_BADGE_CLASSES,
  INTAKE_LANE_LABELS,
  INTAKE_STATUS_PRESENTATIONS,
  buildStatusLabel,
  type IntakeTriageLane,
  type IntakeTriageResponse,
  type IntakeTriageRow,
} from './intake-triage.shared';

/**
 * new_05_import: 処方取込トリアージ(docs/design-gap-analysis-new.md 05_import)。
 * 取込キュー(新着が上・経路レーン切替・行内アクション)→ 重複検知バナー →
 * 工程ストリップ(取込→入力→判断→···)+ 右レール 3 点セットの構成。
 * 手入力フォーム(旧 /prescriptions/new)はヘッダー右「手動で取り込む」から到達する。
 */

type LaneFilter = IntakeTriageLane | 'all';

async function fetchIntakeTriage(orgId: string): Promise<IntakeTriageResponse> {
  const res = await fetch('/api/prescription-intakes/triage', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('取込キューの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function fetchCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション状態の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

/** 受信時刻: 当日は HH:mm、昨日は「昨日 HH:mm」、それ以前は M/d HH:mm。 */
export function formatReceivedAt(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = format(date, 'HH:mm');
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfToday) return time;
  if (date >= startOfYesterday) return `昨日 ${time}`;
  return `${format(date, 'M/d', { locale: ja })} ${time}`;
}

function QueueRow({
  row,
  isPrimaryAction,
  now,
}: {
  row: IntakeTriageRow;
  isPrimaryAction: boolean;
  now: Date;
}) {
  const statusPresentation = INTAKE_STATUS_PRESENTATIONS[row.status];
  const action = INTAKE_ACTION_PRESENTATIONS[row.action];
  const contentLabel = `${row.patient_name} 様 — ${row.content_label}${
    row.rx_number ? ` ${row.rx_number}` : ''
  }`;

  return (
    <TableRow className={cn(statusPresentation.rowClassName)} data-testid="intake-triage-row">
      <TableCell className="w-20 whitespace-nowrap text-sm tabular-nums text-foreground">
        {formatReceivedAt(row.received_at, now)}
      </TableCell>
      <TableCell className="w-20">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            INTAKE_LANE_BADGE_CLASSES[row.lane],
          )}
        >
          {INTAKE_LANE_LABELS[row.lane]}
        </span>
      </TableCell>
      <TableCell className="w-32 max-w-32 truncate whitespace-nowrap text-sm text-foreground">
        {row.issuer ?? '—'}
      </TableCell>
      <TableCell
        className="max-w-[360px] truncate text-sm font-medium text-foreground"
        title={contentLabel}
      >
        {contentLabel}
      </TableCell>
      <TableCell className="w-20 whitespace-nowrap">
        {row.auto_read_percent != null ? (
          <span className="text-sm font-bold text-state-done">{row.auto_read_percent}%</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-36">
        <span
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
            statusPresentation.badgeClassName,
          )}
        >
          {buildStatusLabel(row)}
        </span>
      </TableCell>
      <TableCell className="w-28 text-right">
        <Link
          href={action.href(row)}
          className={buttonVariants({
            variant: isPrimaryAction ? 'default' : 'outline',
            size: 'sm',
            className: '!h-auto !min-h-11 whitespace-nowrap px-3 py-2',
          })}
        >
          {action.label}
        </Link>
      </TableCell>
    </TableRow>
  );
}

function QueueMobileCard({
  row,
  isPrimaryAction,
  now,
}: {
  row: IntakeTriageRow;
  isPrimaryAction: boolean;
  now: Date;
}) {
  const statusPresentation = INTAKE_STATUS_PRESENTATIONS[row.status];
  const action = INTAKE_ACTION_PRESENTATIONS[row.action];
  const contentLabel = `${row.patient_name} 様 — ${row.content_label}${
    row.rx_number ? ` ${row.rx_number}` : ''
  }`;

  return (
    <article
      className={cn(
        'rounded-md border border-border/70 bg-background p-3',
        statusPresentation.rowClassName,
      )}
      data-testid="intake-triage-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{contentLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatReceivedAt(row.received_at, now)} / {row.issuer ?? '発行元未設定'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-1 text-xs font-semibold',
            INTAKE_LANE_BADGE_CLASSES[row.lane],
          )}
        >
          {INTAKE_LANE_LABELS[row.lane]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold',
            statusPresentation.badgeClassName,
          )}
        >
          {buildStatusLabel(row)}
        </span>
        <span className="text-sm text-muted-foreground">
          自動読取{' '}
          {row.auto_read_percent != null ? (
            <strong className="font-bold text-state-done">{row.auto_read_percent}%</strong>
          ) : (
            '未算出'
          )}
        </span>
      </div>

      <Link
        href={action.href(row)}
        className={buttonVariants({
          variant: isPrimaryAction ? 'default' : 'outline',
          className: 'mt-3 min-h-11 w-full justify-center',
        })}
      >
        {action.label}
      </Link>
    </article>
  );
}

/**
 * 工程ストリップ: 取込(完了=緑)→ 入力 → 判断 → ···。
 * 工程語彙は PROCESS_STEPS_9(cycle-workspace.ts)を共有し、先頭 3 工程+省略チップで表す。
 */
function ProcessStrip() {
  const visibleSteps = PROCESS_STEPS_9.slice(0, 3);
  const remainingCount = PROCESS_STEPS_9.length - 1;

  return (
    <section
      aria-label="工程ストリップ"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-card px-4 py-3"
      data-testid="intake-process-strip"
    >
      <ol className="flex items-center" aria-label="工程">
        {visibleSteps.map((step, index) => (
          <li key={step.key} className="flex items-center">
            <span
              data-state={index === 0 ? 'done' : 'upcoming'}
              className={cn(
                'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold',
                index === 0
                  ? 'border-transparent bg-state-done/10 text-state-done'
                  : 'border-border bg-background text-muted-foreground',
              )}
            >
              {step.label}
            </span>
            <span className="mx-1.5 text-xs text-muted-foreground" aria-hidden="true">
              →
            </span>
          </li>
        ))}
        <li>
          <span
            className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
            aria-label="以降の工程"
          >
            ···
          </span>
        </li>
      </ol>
      <p className="text-sm text-muted-foreground">
        取込の正確さが、この先{remainingCount}工程すべての速さを決めます
      </p>
    </section>
  );
}

function TriageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="取込キュー読み込み中">
      <div className="space-y-4">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function IntakeTriageContent() {
  const orgId = useOrgId();
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('fax');
  const isBootstrappingOrg = !orgId;

  const triageQuery = useRealtimeQuery({
    queryKey: ['prescription-intakes', 'triage', orgId],
    queryFn: () => fetchIntakeTriage(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });
  const cockpitQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchCockpit(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = triageQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;
  const dateLabel = `${format(now, 'M/d(EEE)', { locale: ja })} — 新着${
    data?.new_today_count ?? 0
  }件・確認待ち${data?.needs_decision_count ?? 0}件`;

  const laneOptions: Array<FilterChipOption<LaneFilter>> = [
    { value: 'fax', label: 'FAX', count: data?.lane_counts.fax ?? 0 },
    { value: 'online', label: 'オンライン', count: data?.lane_counts.online ?? 0 },
    { value: 'walk_in', label: '持込', count: data?.lane_counts.walk_in ?? 0 },
  ];
  const visibleRows =
    laneFilter === 'all'
      ? (data?.rows ?? [])
      : (data?.rows ?? []).filter((row) => row.lane === laneFilter);
  // 行内の青塗りは「入力へ送る」の先頭 1 行だけ(主操作の乱立を防ぐ)
  const primaryRowId =
    visibleRows.find((row) => INTAKE_ACTION_PRESENTATIONS[row.action].primary)?.intake_id ?? null;

  const duplicateNotices = data?.duplicate_notices ?? [];
  const evidence: EvidenceItem[] = [
    {
      id: 'fax-documents',
      label: '元FAX画像',
      meta: `${data?.evidence.fax_document_count ?? 0}件`,
      href: '/prescriptions',
    },
    {
      id: 'reader-model',
      label: '読取モデルの版',
      meta: data?.evidence.reader_model_version ?? undefined,
      href: '/qr-scan',
    },
    {
      id: 'discard-log',
      label: '破棄ログ',
      meta: `今月${data?.evidence.discard_count_this_month ?? 0}件`,
      href: '/prescriptions/qr-drafts',
    },
  ];

  return (
    <section aria-label="処方取込トリアージ" data-testid="intake-triage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">処方取込</h1>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        <Link
          href="/prescriptions/new"
          className={buttonVariants({
            variant: 'outline',
            className: '!h-auto !min-h-11 px-4 py-2',
          })}
          data-testid="intake-manual-entry-link"
        >
          手動で取り込む
        </Link>
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || triageQuery.isLoading ? (
          <TriageSkeleton />
        ) : triageQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="取込キューを表示できません"
              description="取込キューの取得に失敗しました。再試行してください。"
              detail={triageQuery.error instanceof Error ? triageQuery.error.message : undefined}
              onRetry={() => void triageQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              {/* 取込キュー */}
              <section
                aria-labelledby="intake-queue-heading"
                className="rounded-lg border border-border/70 bg-card p-4"
                data-testid="intake-queue-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="intake-queue-heading" className="text-base font-bold text-foreground">
                    取込キュー
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    新着が上・読取の確からしさは必ず人が確認してから入力へ
                  </p>
                  <FilterChipBar
                    options={laneOptions}
                    value={laneFilter}
                    onChange={(next) =>
                      setLaneFilter((current) => (current === next ? 'all' : next))
                    }
                    ariaLabel="取込経路で絞り込み"
                    className="ml-auto"
                  />
                </div>
                {visibleRows.length > 0 ? (
                  <div className="mt-3 space-y-3 md:hidden">
                    {visibleRows.map((row) => (
                      <QueueMobileCard
                        key={row.intake_id}
                        row={row}
                        isPrimaryAction={row.intake_id === primaryRowId}
                        now={now}
                      />
                    ))}
                  </div>
                ) : null}
                {visibleRows.length > 0 ? (
                  <div className="mt-3 hidden max-h-[360px] overflow-y-auto rounded-md border border-border/70 md:block">
                    <Table className="table-fixed">
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow>
                          <TableHead className="w-20">受信</TableHead>
                          <TableHead className="w-20">経路</TableHead>
                          <TableHead className="w-32">発行元</TableHead>
                          <TableHead>内容</TableHead>
                          <TableHead className="w-20">自動読取</TableHead>
                          <TableHead className="w-36">状態</TableHead>
                          <TableHead className="w-28">
                            <span className="sr-only">アクション</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRows.map((row) => (
                          <QueueRow
                            key={row.intake_id}
                            row={row}
                            isPrimaryAction={row.intake_id === primaryRowId}
                            now={now}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    この経路の取込はいまありません。受信すると新着が上に並びます。
                  </p>
                )}
              </section>

              {/* 重複検知バナー(注意=隠さない) */}
              {duplicateNotices.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm leading-6 text-state-confirm"
                  data-testid="intake-duplicate-banner"
                >
                  <strong className="font-bold">重複検知 {duplicateNotices.length}件:</strong>{' '}
                  {duplicateNotices[0].patient_name}様の
                  {INTAKE_LANE_LABELS[duplicateNotices[0].lane]}は{' '}
                  {duplicateNotices[0].matched_date}{' '}
                  取込分と発行日・Rp構成が一致しています。二重入力を防ぐため、比較してからどちらかを破棄してください(破棄理由は記録されます)。
                </div>
              ) : null}

              <ProcessStrip />
            </div>

            {/* 右レール: 次にやること / 止まっている理由 / 根拠・記録 */}
            <WorkspaceActionRail
              nextAction={buildDailyOpsNextAction(cockpit, {
                actionLabel: '取込キューを確認する',
                actionHref: '/prescriptions',
                description: 'いま期限で止まっている作業はありません。',
              })}
              blockedReasons={buildDailyOpsBlockedReasons(cockpit)}
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
