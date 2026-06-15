'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
import { WorkspaceActionRail } from '@/components/features/workspace/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type {
  ReportsTodayWorkspaceResponse,
  ReportWaitingReply,
} from '@/types/reports-today-workspace';
import {
  buildHeaderMeta,
  buildReportEvidence,
  buildWorkspaceBlockedReasons,
  buildWorkspaceNextAction,
  formatTimeOfDay,
  waitingBadgeLabel,
} from './report-share-workspace.helpers';

/**
 * new_10_report(docs/design-gap-analysis-new.md)「報告・共有」ワークスペース。
 * 本文(今日書く報告 → 返信待ち/今日解決した待ち → テンプレート方針バー)+
 * 右レール(次にやること/止まっている理由/根拠・記録)の 2 カラム構成。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

const DRAFT_STATUS_LABELS: Record<string, string> = {
  before_visit: '訪問後に下書き',
  draft_ready: '下書きあり',
};

async function fetchReportsTodayWorkspace(orgId: string): Promise<ReportsTodayWorkspaceResponse> {
  const res = await fetch('/api/care-reports/today-workspace', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('報告ワークスペースの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション情報の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

// ---------------------------------------------------------------------------
// 今日書く報告
// ---------------------------------------------------------------------------

function TodayDraftsCard({ data }: { data: ReportsTodayWorkspaceResponse }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="report-today-drafts-heading"
      data-testid="report-today-drafts"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="report-today-drafts-heading" className="text-base font-bold text-foreground">
          今日書く報告 — 訪問完了で下書きが開きます
        </h3>
        <p className="text-xs text-muted-foreground">
          記憶が新しいうちに書ける設計 — 宛先別の文面差は1画面で編集
        </p>
      </div>
      {data.draft_rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          本日の訪問予定はありません。訪問が完了すると、ここに報告の下書きが並びます。
        </p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">訪問</TableHead>
              <TableHead>患者</TableHead>
              <TableHead>宛先</TableHead>
              <TableHead className="w-36">状態</TableHead>
              <TableHead className="w-44">
                <span className="sr-only">補足・アクション</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.draft_rows.map((row) => (
              <TableRow key={row.id} data-testid="report-draft-row">
                <TableCell className="font-semibold tabular-nums text-foreground">
                  {row.time_start ? formatTimeOfDay(row.time_start) : '--:--'}
                </TableCell>
                <TableCell className="font-medium text-foreground">{row.patient_label}</TableCell>
                <TableCell className="text-foreground">{row.recipient_label}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {DRAFT_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {row.note ? (
                    // 危険区分メモ(麻薬使用状況を含む 等)は隠さず常時表示する
                    <span className="text-xs text-muted-foreground">{row.note}</span>
                  ) : row.action ? (
                    <Link
                      href={row.action.href}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10 sm:min-h-8"
                    >
                      {row.action.label}
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 返信待ち / 今日解決した待ち
// ---------------------------------------------------------------------------

function WaitingReplyRow({ reply }: { reply: ReportWaitingReply }) {
  return (
    <li
      className="rounded-lg border border-border/70 bg-card p-3"
      data-testid="report-waiting-reply"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          {waitingBadgeLabel(reply.waiting_days)}
        </span>
        <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">{reply.title}</p>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {reply.actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-primary')}
            >
              {action.label}
            </Link>
          ))}
        </span>
      </div>
      {reply.subtitle ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{reply.subtitle}</p>
      ) : null}
    </li>
  );
}

function WaitingBoxesSection({ data }: { data: ReportsTodayWorkspaceResponse }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="report-waiting-heading"
        data-testid="report-waiting-box"
      >
        <div className="flex items-baseline gap-2">
          <h3 id="report-waiting-heading" className="text-base font-bold text-foreground">
            返信待ち
          </h3>
          <span className="text-xs text-muted-foreground">{data.counts.waiting}件</span>
        </div>
        {data.waiting_replies.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">返信待ちはありません。</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {data.waiting_replies.map((reply) => (
              <WaitingReplyRow key={reply.id} reply={reply} />
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="report-resolved-heading"
        data-testid="report-resolved-box"
      >
        <div className="flex items-baseline gap-2">
          <h3 id="report-resolved-heading" className="text-base font-bold text-foreground">
            今日解決した待ち
          </h3>
          <span className="text-xs text-muted-foreground">{data.counts.resolved}件</span>
        </div>
        {data.resolved_today.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">今日解決した待ちはまだありません。</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {data.resolved_today.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"
                data-testid="report-resolved-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    回答受領 {formatTimeOfDay(item.received_at)}
                  </span>
                  <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">
                    {item.title}
                  </p>
                  <Link
                    href={item.action.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'shrink-0 text-primary',
                    )}
                  >
                    {item.action.label}
                  </Link>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{item.subtitle}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function WorkspaceSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]"
      role="status"
      aria-label="報告・共有ワークスペース読み込み中"
    >
      <div className="space-y-4">
        <Skeleton className="h-52 w-full rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function ReportShareWorkspace() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;

  const workspaceQuery = useQuery({
    queryKey: ['care-reports', 'today-workspace', orgId],
    queryFn: () => fetchReportsTodayWorkspace(orgId),
    enabled: !isBootstrappingOrg,
    refetchInterval: 30_000,
  });
  const cockpitQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchOperationCockpit(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg && workspaceQuery.isSuccess,
  });

  const now = new Date();
  const data = workspaceQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;

  return (
    <section aria-label="報告・共有ワークスペース" data-testid="report-share-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">報告・共有</h2>
          <p className="text-sm text-muted-foreground">
            {buildHeaderMeta(now, data?.counts ?? null)}
          </p>
        </div>
        <Link
          href="/admin/document-templates"
          className={buttonVariants({ variant: 'outline' })}
          data-testid="report-edit-templates"
        >
          テンプレートを編集
        </Link>
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || workspaceQuery.isLoading ? (
          <WorkspaceSkeleton />
        ) : workspaceQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="報告・共有を表示できません"
              description="当日報告ワークスペースの集計取得に失敗しました。再試行してください。"
              detail={
                workspaceQuery.error instanceof Error ? workspaceQuery.error.message : undefined
              }
              action={{ label: '再試行', onClick: () => void workspaceQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
            <div className="min-w-0 space-y-4">
              <TodayDraftsCard data={data} />
              <WaitingBoxesSection data={data} />
              <p
                className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800"
                data-testid="report-template-policy-bar"
              >
                テンプレートは宛先ごとに自動選択されます(医師向け/ケアマネ向け/施設向け)。印象ではなく事実を書く構成です:
                実施したこと → 観察したこと → 提案。
              </p>
            </div>
            <div className="space-y-4">
              <WorkspaceActionRail
                nextAction={buildWorkspaceNextAction(cockpit)}
                blockedReasons={buildWorkspaceBlockedReasons(cockpit)}
                blockedReasonsEmptyLabel="止まっている作業はありません"
                evidence={buildReportEvidence(data)}
                evidenceOpenLabel="開く"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
