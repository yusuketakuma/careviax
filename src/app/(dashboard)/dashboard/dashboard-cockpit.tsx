'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Lock, TriangleAlert } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type {
  CockpitAuditQueueItem,
  CockpitTeamMember,
  CockpitVisit,
  DashboardCockpitScope,
  DashboardCockpitResponse,
} from '@/types/dashboard-cockpit';
import {
  buildBottleneckNote,
  buildTeamHandoffSuggestion,
  buildConditionSummary,
  buildProcessNowTiles,
  buildTimelineBlocks,
  formatAgeLabel,
  formatDeadlineCountdown,
  formatTimeOfDay,
  TIMELINE_END_MINUTES,
  TIMELINE_START_MINUTES,
  timelinePercent,
  type ProcessNowTile,
} from './dashboard-cockpit.helpers';

/**
 * new_01_dashboard の運用コックピット(docs/design-gap-analysis-new.md)。
 * 本文(条件バナー → 今すぐ対応 → 今日の流れ → 工程の今)+ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録 + 私の今日)の 2 カラム構成。
 * レスポンシブ方針: lg(1024px)以上で 2 カラム、未満は 1 カラム縦積み。
 * どの幅でも全要素を表示し、viewport 条件で内容を隠さない。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

export async function fetchDashboardCockpit(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitResponse> {
  const params = new URLSearchParams({ scope });
  const res = await fetch(`/api/dashboard/cockpit?${params.toString()}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('ダッシュボード集計の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

type DashboardViewScope = 'mine' | 'team';

const VIEW_SCOPE_OPTIONS: Array<{ value: DashboardViewScope; label: string }> = [
  { value: 'mine', label: '私の今日' },
  { value: 'team', label: 'チーム全体' },
];

// ---------------------------------------------------------------------------
// 条件バナー
// ---------------------------------------------------------------------------

function ConditionBanner({ data }: { data: DashboardCockpitResponse }) {
  const visitTimes = data.today_visits
    .filter((visit) => visit.time_start != null)
    .map((visit) => formatTimeOfDay(visit.time_start as string));
  const summary = buildConditionSummary({
    auditPendingCount: data.audit_pending_count,
    narcoticAuditCount: data.narcotic_audit_count,
    earliestAuditDueAt:
      data.audit_queue
        .map((item) => item.due_at)
        .filter((dueAt): dueAt is string => dueAt != null)
        .sort()[0] ?? null,
    visitTimes,
  });

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3"
      data-testid="dashboard-condition-banner"
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold',
          summary.tone === 'conditional'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-emerald-100 text-emerald-800',
        )}
      >
        {summary.pillLabel}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
        {summary.parts.map((part, index) =>
          part.strong ? (
            <strong key={index} className="font-bold text-foreground">
              {part.text}
            </strong>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <a
        href="#dashboard-process-now"
        className="shrink-0 text-sm font-medium text-primary hover:underline"
      >
        根拠を見る →
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 今すぐ対応
// ---------------------------------------------------------------------------

function UrgentNowCard({
  item,
  isPrimary,
  now,
}: {
  item: CockpitAuditQueueItem;
  isPrimary: boolean;
  now: Date;
}) {
  const accentClass = item.has_narcotic
    ? 'bg-red-500'
    : item.priority === 'emergency' || item.priority === 'urgent'
      ? 'bg-orange-500'
      : 'bg-blue-500';
  const typePill = item.has_narcotic
    ? { label: '麻薬監査', className: 'bg-red-100 text-red-700' }
    : { label: '調剤監査', className: 'bg-blue-100 text-blue-700' };
  const rxNumber = formatPrescriptionCardNumber(
    item.intake_id ?? item.cycle_id,
    item.prescribed_date,
    'rx_year',
  );
  const countdown = item.due_at ? formatDeadlineCountdown(item.due_at, now) : null;
  const waitingMinutes = item.waiting_since
    ? Math.max(0, Math.floor((now.getTime() - new Date(item.waiting_since).getTime()) / 60_000))
    : null;

  return (
    <article
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-card p-4 pl-5"
      data-testid="dashboard-urgent-card"
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', accentClass)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{rxNumber}</span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
            typePill.className,
          )}
        >
          {typePill.label}
        </span>
      </div>
      <p className="text-sm font-bold text-foreground">{item.patient_name} 様</p>
      <div className="flex flex-wrap gap-1">
        {item.handling_tags.length > 0 ? (
          item.handling_tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                getHandlingTagBadgeClass(tag),
              )}
            >
              {getHandlingTagLabel(tag)}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            安全タグなし
          </span>
        )}
      </div>
      <p className="text-sm leading-5 text-muted-foreground">
        {item.has_narcotic
          ? '麻薬を含む監査待ちです。完了しないと訪問の持参準備が始まりません。'
          : '調剤済みの監査待ちです。完了でセット・訪問準備に進めます。'}
      </p>
      {countdown ? (
        <p className="text-sm font-bold text-destructive">
          期限 {formatTimeOfDay(item.due_at as string)} — {countdown.label}
        </p>
      ) : waitingMinutes != null ? (
        <p className="text-sm font-semibold text-amber-700">
          {formatAgeLabel(waitingMinutes)}前から監査待ちです
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {isPrimary ? (
          <Button asChild className="min-h-[40px]">
            <Link href="/audit">監査を開始する</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="min-h-[40px]">
            <Link href="/audit">監査を開く</Link>
          </Button>
        )}
        <Link href="/audit" className="text-sm font-medium text-primary hover:underline">
          → 監査へ
        </Link>
      </div>
    </article>
  );
}

function UrgentNowSection({
  items,
  totalCount,
  now,
}: {
  items: CockpitAuditQueueItem[];
  totalCount: number;
  now: Date;
}) {
  const cards = items.slice(0, 3);
  const shownCountLabel =
    totalCount > cards.length ? `表示 ${cards.length}/${totalCount}件` : `${cards.length}件`;

  return (
    <section aria-labelledby="dashboard-urgent-now-heading" data-testid="dashboard-urgent-now">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="dashboard-urgent-now-heading" className="text-base font-bold text-foreground">
          今すぐ対応
        </h3>
        <p className="text-xs text-muted-foreground">
          期限と待ち解除だけがここに並びます・緊急度順
        </p>
        <span className="ml-auto inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
          {shownCountLabel}
        </span>
      </div>
      {totalCount > cards.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          全{totalCount}件のうち、期限が近い{cards.length}件を表示しています。
        </p>
      ) : null}
      {cards.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border/70 bg-card px-4 py-6 text-sm text-muted-foreground">
          いま期限・待ち解除で対応が必要な処方サイクルはありません。
        </p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {cards.map((item, index) => (
            <UrgentNowCard key={item.task_id} item={item} isPrimary={index === 0} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 今日の流れ(タイムライン)
// ---------------------------------------------------------------------------

const TIMELINE_BLOCK_CLASSES = {
  visit: 'bg-emerald-700 text-white',
  desk: 'bg-primary text-primary-foreground',
  break: 'border border-border/70 bg-muted text-muted-foreground',
} as const;

function TodayFlowSection({
  visits,
  auditCount,
  narcoticAuditCount,
  reportCount,
  now,
}: {
  visits: CockpitVisit[];
  auditCount: number;
  narcoticAuditCount: number;
  reportCount: number;
  now: Date;
}) {
  const blocks = buildTimelineBlocks({ visits, auditCount, narcoticAuditCount, reportCount });
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowMarker = nowMinutes >= TIMELINE_START_MINUTES && nowMinutes <= TIMELINE_END_MINUTES;
  const hourLabels: string[] = [];
  for (let minutes = TIMELINE_START_MINUTES; minutes <= TIMELINE_END_MINUTES; minutes += 60) {
    hourLabels.push(`${Math.floor(minutes / 60)}:00`);
  }

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="dashboard-today-flow-heading"
      data-testid="dashboard-today-flow"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="dashboard-today-flow-heading" className="text-base font-bold text-foreground">
          今日の流れ
        </h3>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3 text-emerald-700" aria-hidden="true" />
          訪問は動かせない固定点・デスク作業はその間を流れます
        </p>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href="/schedules">→ スケジュールへ</Link>
        </Button>
      </div>
      <div className="mt-4">
        <div aria-hidden="true" className="flex justify-between text-[10px] text-muted-foreground">
          {hourLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="relative mt-1">
          <ol
            aria-label="今日の流れ(9:00〜18:00)"
            className="relative h-10 overflow-hidden rounded-md border border-border/60 bg-muted/30"
          >
            {blocks.map((block) => {
              const left = timelinePercent(block.startMinutes);
              const width = Math.max(timelinePercent(block.endMinutes) - left, 2);
              return (
                <li
                  key={block.id}
                  data-kind={block.kind}
                  title={block.label}
                  className={cn(
                    'absolute inset-y-1 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1.5 text-[11px] font-medium',
                    TIMELINE_BLOCK_CLASSES[block.kind],
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {block.locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
                  <span className="truncate">
                    {block.label}
                    {block.locked ? <span className="sr-only">(固定の訪問)</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {showNowMarker ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500"
              style={{ left: `${timelinePercent(nowMinutes)}%` }}
            />
          ) : null}
        </div>
        {showNowMarker ? (
          <p
            className="mt-1 text-xs font-semibold text-red-600"
            style={{ paddingLeft: `${Math.min(timelinePercent(nowMinutes), 88)}%` }}
          >
            いま {formatTimeOfDay(now.toISOString())}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 工程の今
// ---------------------------------------------------------------------------

const PROCESS_TILE_TONE_CLASSES: Record<ProcessNowTile['tone'], { tile: string; count: string }> = {
  over: { tile: 'border-red-300 bg-red-50', count: 'text-red-600' },
  near: { tile: 'border-amber-300 bg-amber-50', count: 'text-amber-700' },
  normal: { tile: 'border-border/70 bg-background', count: 'text-foreground' },
};

function ProcessNowSection({ statusCounts }: { statusCounts: Record<string, number> }) {
  const tiles = buildProcessNowTiles(statusCounts);
  const bottleneckNote = buildBottleneckNote(tiles);

  return (
    <section
      id="dashboard-process-now"
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="dashboard-process-now-heading"
      data-testid="dashboard-process-now"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="dashboard-process-now-heading" className="text-base font-bold text-foreground">
          工程の今
        </h3>
        <p className="text-xs text-muted-foreground">チーム全体の仕掛かり</p>
        <Link href="/handoff" className="ml-auto text-sm font-medium text-primary hover:underline">
          → ハンドオフで再配分
        </Link>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {tiles.map((tile) => (
          <li
            key={tile.key}
            data-tone={tile.tone}
            className={cn(
              'rounded-md border px-2 py-2 text-center',
              PROCESS_TILE_TONE_CLASSES[tile.tone].tile,
            )}
          >
            <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
            <p
              className={cn(
                'text-xl font-bold tabular-nums leading-7',
                PROCESS_TILE_TONE_CLASSES[tile.tone].count,
              )}
            >
              {tile.count}
            </p>
            <p className="text-[10px] text-muted-foreground">目安{tile.guide}</p>
          </li>
        ))}
      </ol>
      {bottleneckNote ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800">
          {bottleneckNote}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// チームの余白
// ---------------------------------------------------------------------------

const TEAM_SLACK_CRITICAL_MINUTES = 30;
const TEAM_SLACK_AMPLE_MINUTES = 90;

type TeamSlackTone = 'critical' | 'normal' | 'ample';

const TEAM_SLACK_TONE_CLASSES: Record<TeamSlackTone, { bar: string; label: string }> = {
  critical: { bar: 'bg-red-500', label: 'text-red-600' },
  normal: { bar: 'bg-blue-500', label: 'text-foreground' },
  ample: { bar: 'bg-green-500', label: 'text-green-600' },
};

function teamSlackTone(slackMinutes: number): TeamSlackTone {
  if (slackMinutes < TEAM_SLACK_CRITICAL_MINUTES) return 'critical';
  if (slackMinutes < TEAM_SLACK_AMPLE_MINUTES) return 'normal';
  return 'ample';
}

function TeamCapacityCard({
  team,
  suggestion,
}: {
  team: CockpitTeamMember[];
  suggestion: string | null;
}) {
  if (team.length === 0) return null;

  return (
    <section
      aria-labelledby="dashboard-team-capacity-heading"
      className="rounded-lg border border-border/70 bg-card p-4"
      data-testid="dashboard-team-capacity"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id="dashboard-team-capacity-heading" className="text-base font-bold text-foreground">
          チームの余白
        </h3>
        <p className="text-xs text-muted-foreground">残り時間</p>
      </div>
      <ul className="mt-3 space-y-3" role="list">
        {team.map((member) => {
          const familyName = member.name.split(/[\s　]+/)[0] ?? member.name;
          if (member.status === 'off') {
            return (
              <li key={member.user_id} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground">
                  {familyName}({member.role_label})
                </span>
                <span className="h-2 min-w-0 flex-1 rounded-full bg-muted/60" aria-hidden="true" />
                <span className="w-20 shrink-0 text-right text-sm text-muted-foreground">休み</span>
              </li>
            );
          }

          const slack = member.slack_minutes ?? 0;
          const tone = teamSlackTone(slack);
          const busyPercent = Math.round((member.busy_ratio ?? 0) * 100);
          return (
            <li key={member.user_id} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium text-foreground">
                {familyName}({member.role_label})
              </span>
              <span
                className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`残り時間の使用率 ${busyPercent}%`}
              >
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full',
                    TEAM_SLACK_TONE_CLASSES[tone].bar,
                  )}
                  style={{ width: `${Math.max(busyPercent, 4)}%` }}
                />
              </span>
              <span
                className={cn(
                  'flex w-24 shrink-0 items-center justify-end gap-1 text-right text-sm font-semibold tabular-nums',
                  TEAM_SLACK_TONE_CLASSES[tone].label,
                )}
              >
                余白 {slack}分
                {tone === 'critical' ? (
                  <TriangleAlert className="size-3.5 shrink-0" aria-label="余白がわずかです" />
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {suggestion ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
          <span>{suggestion}</span>
          <Link
            href="/handoff"
            className="inline-flex items-center rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            → ハンドオフへ
          </Link>
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 右レール(次にやること / 止まっている理由 / 根拠・記録)
// ---------------------------------------------------------------------------

function buildNextAction(
  topAudit: CockpitAuditQueueItem | null,
  visitCount: number,
): NextActionPanelProps {
  if (topAudit) {
    const auditLabel = topAudit.has_narcotic ? '麻薬監査' : '監査';
    return {
      actionLabel: topAudit.due_at
        ? `${auditLabel}を開始 — ${formatTimeOfDay(topAudit.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: `${topAudit.patient_name} 様の調剤監査が待ちです。完了で次の工程が動き出します。`,
      actionHref: '/audit',
    };
  }
  if (visitCount > 0) {
    return {
      actionLabel: '訪問準備を確認する',
      description: `本日の訪問 ${visitCount}件の準備状況を確認します。`,
      actionHref: '/schedules',
    };
  }
  return {
    actionLabel: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    actionHref: '/schedules',
  };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function CockpitSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="ダッシュボード読み込み中">
      <div className="space-y-4">
        <Skeleton className="h-14 w-full rounded-lg" />
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function DashboardCockpit() {
  const orgId = useOrgId();
  const [viewScope, setViewScope] = useState<DashboardViewScope>('mine');
  const isBootstrappingOrg = !orgId;

  const cockpitQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', orgId, viewScope],
    queryFn: () => fetchDashboardCockpit(orgId, viewScope),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = cockpitQuery.data ?? null;
  const appliedScope = data?.scope?.applied ?? viewScope;
  const canViewTeam = data?.scope?.can_view_team ?? true;
  const scopeLabel =
    VIEW_SCOPE_OPTIONS.find((option) => option.value === appliedScope)?.label ?? '私の今日';
  const dateLabel = `${format(now, 'M/d(EEE) HH:mm', { locale: ja })} — ${scopeLabel}`;

  const todayVisits = data?.today_visits ?? [];
  const topAudit = data?.audit_queue[0] ?? null;
  const blockedReasons: BlockedReason[] = (data?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category ?? undefined,
    ageLabel: formatAgeLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));
  const evidence: EvidenceItem[] = [
    {
      id: 'sync',
      label: '今朝の同期',
      meta: data ? formatTimeOfDay(data.generated_at) : '—',
      onView: () => void cockpitQuery.refetch(),
    },
    {
      id: 'carryover',
      label: '昨日からの持ち越し',
      meta: `${data?.carryover_count ?? 0}件`,
      href: '/workflow',
    },
    {
      id: 'wip-guide',
      label: 'WIP目安の設定',
      meta: '標準値',
      href: '#dashboard-process-now',
    },
  ];

  return (
    <section aria-label="運用コックピット" data-testid="dashboard-cockpit">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">ダッシュボード</h1>
          <p className="text-sm font-medium text-muted-foreground">PH-OS ダッシュボード</p>
          {/* HH:mm を含むため、SSR とハイドレーションが分を跨ぐと text mismatch になる */}
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {dateLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/prescriptions/new"
            className={cn(
              buttonVariants({ variant: 'default', size: 'sm' }),
              'min-h-[44px] px-3 sm:min-h-0',
            )}
          >
            処方受付
          </Link>
          <FilterChipBar
            options={VIEW_SCOPE_OPTIONS.map((option) =>
              option.value === 'team' && !canViewTeam
                ? {
                    ...option,
                    disabled: true,
                    disabledReason: 'チーム全体は管理者だけが表示できます',
                  }
                : option,
            )}
            value={appliedScope}
            onChange={setViewScope}
            ariaLabel="表示範囲の切替"
          />
        </div>
      </div>
      {data?.scope?.applied === 'mine' && !data.scope.can_view_team ? (
        <p className="mt-2 text-xs text-muted-foreground">
          この画面は担当患者・担当ケースの範囲で集計しています。チーム全体の集計は管理者だけが表示できます。
        </p>
      ) : null}

      <div className="mt-4">
        {isBootstrappingOrg || cockpitQuery.isLoading ? (
          <CockpitSkeleton />
        ) : cockpitQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="ダッシュボードを表示できません"
              description="運用コックピットの集計取得に失敗しました。再試行してください。"
              detail={cockpitQuery.error instanceof Error ? cockpitQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void cockpitQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <ConditionBanner data={data} />
              <UrgentNowSection
                items={data.audit_queue}
                totalCount={data.audit_pending_count}
                now={now}
              />
              <TodayFlowSection
                visits={todayVisits}
                auditCount={data.audit_pending_count}
                narcoticAuditCount={data.narcotic_audit_count}
                reportCount={data.cycle_status_counts['visit_completed'] ?? 0}
                now={now}
              />
              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
                <ProcessNowSection statusCounts={data.cycle_status_counts} />
                <TeamCapacityCard
                  team={data.team_capacity ?? []}
                  suggestion={buildTeamHandoffSuggestion(
                    buildProcessNowTiles(data.cycle_status_counts),
                    data.team_capacity ?? [],
                  )}
                />
              </div>
            </div>
            {/*
             * 右レールはデザイン 01 の 3 点セット(次にやること / 止まっている理由 / 根拠・記録)のみ。
             * 「チームの会話」: 直近コメントを横断取得するフィード API が無いため
             * (/api/comments は entity 単位の取得のみ)、第一版ではセクション自体を省略。
             */}
            <WorkspaceActionRail
              nextAction={buildNextAction(topAudit, todayVisits.length)}
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
