'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Lock, MessageSquare, TriangleAlert } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/loading';
import { SegmentError, SegmentStaleBanner } from '@/components/ui/segment-state';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type {
  CockpitCommentItem,
  CockpitInboundItem,
  CockpitTeamMember,
  CockpitVisit,
  DashboardCockpitCommentsResponse,
  DashboardCockpitScope,
  DashboardCockpitDetailsResponse,
  DashboardCockpitInboundResponse,
  DashboardCockpitResponse,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
  DashboardUrgentItem,
  DashboardUrgentSourceLink,
} from '@/types/dashboard-cockpit';
import type { DashboardFocusRole } from './dashboard-role-focus';
import {
  buildBottleneckNote,
  buildConditionSummary,
  COCKPIT_FRESHNESS_WINDOW_MS,
  buildTimelineBlocks,
  TIMELINE_END_MINUTES,
  TIMELINE_START_MINUTES,
  timelinePercent,
  type ProcessNowTile,
} from './dashboard-cockpit.helpers';
import {
  DashboardGeneratedAtMeta,
  DashboardHeaderClock,
  DashboardNowMarker,
  DeadlineCountdownLabel,
  WaitingSinceLabel,
} from './dashboard-clock';
import { useDashboardCockpitViewModel } from './use-dashboard-cockpit-view-model';

/**
 * new_01_dashboard の運用コックピット(docs/design-gap-analysis-new.md)。
 * 本文(条件バナー → 今すぐ対応 → 今日の流れ → 工程の今)+ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録 + 私の今日)の 2 カラム構成。
 * レスポンシブ方針: lg(1024px)以上で 2 カラム、未満は 1 カラム縦積み。
 * どの幅でも全要素を表示し、viewport 条件で内容を隠さない。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

const DASHBOARD_COMMENTS_DRILLDOWN_HREF = '/handoff?filter=comments&context=dashboard_home';
const DASHBOARD_INBOUND_DRILLDOWN_HREF = '/communications/inbound?status=needs_review';
const DASHBOARD_CARRYOVER_HREF = '/tasks?status=open&filter=carryover&context=dashboard_home';

export async function fetchDashboardCockpit(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitResponse> {
  const params = new URLSearchParams({ scope });
  const res = await fetch(`/api/dashboard/cockpit?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: DashboardCockpitResponse }>(
    res,
    'ダッシュボード集計の取得に失敗しました',
  );
  return json.data;
}

async function fetchDashboardCockpitSegment<TData>(
  orgId: string,
  scope: DashboardCockpitScope,
  segment: 'summary' | 'details' | 'team' | 'comments' | 'inbound',
  errorMessage: string,
): Promise<TData> {
  const params = new URLSearchParams({ scope });
  const res = await fetch(`/api/dashboard/cockpit/${segment}?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: TData }>(res, errorMessage);
  return json.data;
}

export function fetchDashboardCockpitSummary(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitSummaryResponse> {
  return fetchDashboardCockpitSegment(
    orgId,
    scope,
    'summary',
    'ダッシュボード概要の取得に失敗しました',
  );
}

export function fetchDashboardCockpitDetails(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitDetailsResponse> {
  return fetchDashboardCockpitSegment(
    orgId,
    scope,
    'details',
    'ダッシュボード詳細の取得に失敗しました',
  );
}

export function fetchDashboardCockpitTeam(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitTeamResponse> {
  return fetchDashboardCockpitSegment(orgId, scope, 'team', 'チーム状況の取得に失敗しました');
}

export function fetchDashboardCockpitComments(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitCommentsResponse> {
  return fetchDashboardCockpitSegment(orgId, scope, 'comments', 'チームの会話の取得に失敗しました');
}

export function fetchDashboardCockpitInbound(
  orgId: string,
  scope: DashboardCockpitScope = 'mine',
): Promise<DashboardCockpitInboundResponse> {
  return fetchDashboardCockpitSegment(orgId, scope, 'inbound', '他職種受信の取得に失敗しました');
}

type DashboardViewScope = 'mine' | 'team';

const VIEW_SCOPE_OPTIONS: Array<{ value: DashboardViewScope; label: string }> = [
  { value: 'mine', label: '私の今日' },
  { value: 'team', label: 'チーム全体' },
];

const FOCUS_ROLE_HINT: Record<DashboardFocusRole, string> = {
  pharmacist: '薬剤師フォーカス: 監査・訪問準備を優先',
  clerk: '事務フォーカス: 連絡・報告・請求を優先',
  common: '共通フォーカス: 要対応を優先',
};

const DASHBOARD_COCKPIT_WORKFLOW_SOURCES = [
  'schedule_conflict_resolution',
  'cycle_holds_create',
  'cycle_holds_resolve',
  'dispense_audits',
  'dispense_results',
  'dispense_results_rework',
  'dispense_tasks_update',
  'facility_visit_batch_delete',
  'facility_visit_batch_reorder',
  'facility_visit_batches_upsert',
  'facility_visit_days_upsert',
  'inquiry_records_update',
  'medication_cycles_transition',
  'medication_issues_update',
  'prescription_intakes_create',
  'set_audits',
  'set_batches_create',
  'set_batches_delete',
  'set_batches_generate',
  'set_batches_update',
  'set_plans',
  'set_plans_update',
  'visit_schedule_proposals_approve',
  'visit_schedule_proposals_confirm',
  'visit_schedule_proposals_contact_attempt',
  'visit_schedule_proposals_create',
  'visit_schedule_proposals_reject',
  'visit_schedule_proposals_reorder',
  'visit_preparations_update',
  'visit_routes_mixed_reorder',
  'visit_schedule_conflict_reconfirmation',
  'visit_schedules_create',
  'visit_schedules_delete',
  'visit_schedules_generate',
  'visit_schedules_reopen',
  'visit_schedules_reorder',
  'visit_schedules_reschedule_approve',
  'visit_schedules_reschedule_request',
  'visit_schedules_update',
] as const;

const DASHBOARD_SUMMARY_REALTIME_EVENTS = [
  'cycle_transition',
  { type: 'workflow_refresh', source: DASHBOARD_COCKPIT_WORKFLOW_SOURCES },
] as const;

const DASHBOARD_INBOUND_REALTIME_EVENTS = [
  {
    type: 'workflow_refresh',
    source: ['inbound_communications_update', 'inbound_signal_update'],
  },
] as const;

const DASHBOARD_DETAILS_REALTIME_EVENTS = [
  ...DASHBOARD_SUMMARY_REALTIME_EVENTS,
  ...DASHBOARD_INBOUND_REALTIME_EVENTS,
] as const;

const DASHBOARD_TEAM_WORKFLOW_SOURCES = [
  'facility_visit_batch_delete',
  'facility_visit_batch_reorder',
  'facility_visit_batches_upsert',
  'facility_visit_days_upsert',
  'pharmacist_shifts_update',
  'visit_routes_mixed_reorder',
  'visit_schedule_conflict_reconfirmation',
  'visit_schedules_create',
  'visit_schedules_delete',
  'visit_schedules_generate',
  'visit_schedules_reopen',
  'visit_schedules_reorder',
  'visit_schedules_reschedule_approve',
  'visit_schedules_reschedule_request',
  'visit_schedules_update',
] as const;

const DASHBOARD_TEAM_REALTIME_EVENTS = [
  { type: 'workflow_refresh', source: DASHBOARD_TEAM_WORKFLOW_SOURCES },
] as const;

// ---------------------------------------------------------------------------
// 条件バナー
// ---------------------------------------------------------------------------

function ConditionBanner({ data }: { data: DashboardCockpitSummaryResponse }) {
  const summary = buildConditionSummary({
    auditPendingCount: data.audit_pending_count,
    narcoticAuditCount: data.narcotic_audit_count,
    earliestAuditDueAt: data.earliest_audit_due_at,
    visitTimes: data.today_visit_times,
  });

  return (
    <div
      className="grid gap-2 rounded-lg border border-border/70 bg-card px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
      data-testid="dashboard-condition-banner"
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-self-start rounded-full px-3 py-1 text-xs font-bold',
          summary.tone === 'conditional'
            ? 'bg-state-confirm/10 text-state-confirm'
            : 'bg-state-done/10 text-state-done',
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
        className="inline-flex min-h-11 shrink-0 items-center justify-self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:justify-self-end"
      >
        根拠を見る →
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 今すぐ対応
// ---------------------------------------------------------------------------

function UrgentNowCard({ item, isPrimary }: { item: DashboardUrgentItem; isPrimary: boolean }) {
  const accentClass =
    item.severity === 'blocking'
      ? 'bg-tag-hazard'
      : item.severity === 'urgent'
        ? 'bg-state-confirm'
        : 'bg-tag-info';
  const typePill =
    item.source === 'audit'
      ? item.source_label === '麻薬監査'
        ? { label: item.source_label, className: 'bg-tag-hazard/10 text-tag-hazard' }
        : { label: item.source_label, className: 'bg-tag-info/10 text-tag-info' }
      : item.source === 'inbound'
        ? { label: item.source_label, className: 'bg-primary/10 text-primary' }
        : { label: item.source_label, className: 'bg-muted text-muted-foreground' };
  return (
    <article
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-card p-4 pl-5"
      data-testid="dashboard-urgent-card"
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', accentClass)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{item.reference_label}</span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            typePill.className,
          )}
        >
          {typePill.label}
        </span>
      </div>
      <p className="text-sm font-bold text-foreground">
        {item.patient_name ? `${item.patient_name} 様` : item.title}
      </p>
      <div className="flex flex-wrap gap-1">
        {item.badges.length > 0 ? (
          item.badges.map((badge) => (
            <span
              key={`${item.id}:${badge.label}`}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                badge.tone === 'danger'
                  ? 'border-tag-hazard/30 bg-tag-hazard/10 text-tag-hazard'
                  : badge.tone === 'warning'
                    ? 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm'
                    : badge.tone === 'success'
                      ? 'border-chart-2/30 bg-chart-2/10 text-chart-2'
                      : badge.tone === 'info'
                        ? 'border-tag-info/30 bg-tag-info/10 text-tag-info'
                        : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {badge.label}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            安全タグなし
          </span>
        )}
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{item.summary}</p>
      {item.due_at ? (
        <DeadlineCountdownLabel dueAt={item.due_at} />
      ) : item.waiting_since ? (
        <WaitingSinceLabel waitingSince={item.waiting_since} />
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {isPrimary ? (
          <Button asChild>
            <Link href={item.action_href}>{item.action_label}</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={item.action_href}>
              {item.source === 'audit' ? '監査を開く' : item.action_label}
            </Link>
          </Button>
        )}
        <Link href={item.action_href} className="text-sm font-medium text-primary hover:underline">
          → 詳細へ
        </Link>
      </div>
    </article>
  );
}

function UrgentNowSection({
  items,
  sourceLinks,
  totalCount,
}: {
  items: DashboardUrgentItem[];
  sourceLinks: DashboardUrgentSourceLink[];
  totalCount: number;
}) {
  const cards = items.slice(0, 3);
  const shownCountLabel =
    totalCount > cards.length ? `表示 ${cards.length}/${totalCount}件` : `${cards.length}件`;

  return (
    <section aria-labelledby="dashboard-urgent-now-heading" data-testid="dashboard-urgent-now">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="dashboard-urgent-now-heading" className="text-base font-bold text-foreground">
          今すぐ対応
        </h2>
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
          いま期限・待ち解除で対応が必要な業務はありません。
        </p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {cards.map((item, index) => (
            <UrgentNowCard key={item.id} item={item} isPrimary={index === 0} />
          ))}
        </div>
      )}
      {sourceLinks.length > 0 ? (
        <div
          aria-label="今すぐ対応の種別別リンク"
          className="mt-3 flex flex-wrap gap-2"
          data-testid="dashboard-urgent-source-links"
        >
          {sourceLinks.map((link) => {
            const countLabel =
              link.hidden_count > 0
                ? `全${link.total_count}件 / 表示候補${link.visible_count}件 / 未読込${link.hidden_count}件`
                : `全${link.total_count}件`;
            return (
              <Link
                key={link.source}
                href={link.href}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
                aria-label={`${link.label}を開く。${countLabel}`}
                data-count-basis={link.count_basis}
              >
                <span>{link.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {countLabel}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 今日の流れ(タイムライン)
// ---------------------------------------------------------------------------

const TIMELINE_BLOCK_CLASSES = {
  visit: 'bg-chart-2 text-white',
  desk: 'bg-primary text-primary-foreground',
  break: 'border border-border/70 bg-muted text-muted-foreground',
} as const;

function TodayFlowSection({
  visits,
  auditCount,
  narcoticAuditCount,
  reportCount,
}: {
  visits: CockpitVisit[];
  auditCount: number;
  narcoticAuditCount: number;
  reportCount: number;
}) {
  const blocks = buildTimelineBlocks({ visits, auditCount, narcoticAuditCount, reportCount });
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
        <h2 id="dashboard-today-flow-heading" className="text-base font-bold text-foreground">
          今日の流れ
        </h2>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3 text-chart-2" aria-hidden="true" />
          訪問は動かせない固定点・デスク作業はその間を流れます
        </p>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href="/schedules">→ スケジュールへ</Link>
        </Button>
      </div>
      <div className="mt-4">
        <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
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
                    'absolute inset-y-1 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1.5 text-xs font-medium',
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
          <DashboardNowMarker />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 工程の今
// ---------------------------------------------------------------------------

const PROCESS_TILE_TONE_CLASSES: Record<ProcessNowTile['tone'], { tile: string; count: string }> = {
  over: {
    tile: 'border-border/70 border-l-4 border-l-state-blocked bg-card',
    count: 'text-state-blocked',
  },
  near: {
    tile: 'border-border/70 border-l-4 border-l-state-confirm bg-card',
    count: 'text-state-confirm',
  },
  normal: { tile: 'border-border/70 bg-background', count: 'text-foreground' },
};

function ProcessNowSection({ tiles }: { tiles: ProcessNowTile[] }) {
  const bottleneckNote = buildBottleneckNote(tiles);

  return (
    <section
      id="dashboard-process-now"
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="dashboard-process-now-heading"
      data-testid="dashboard-process-now"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="dashboard-process-now-heading" className="text-base font-bold text-foreground">
          工程の今
        </h2>
        <p className="text-xs text-muted-foreground">チーム全体の仕掛かり</p>
        <Link href="/handoff" className="ml-auto text-sm font-medium text-primary hover:underline">
          → ハンドオフで再配分
        </Link>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {tiles.map((tile) => (
          <li key={tile.key} data-tone={tile.tone}>
            <Link
              href={tile.href}
              aria-label={tile.ariaLabel}
              className={cn(
                'block min-h-11 rounded-md border px-2 py-2 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
              <p className="text-xs text-muted-foreground">目安{tile.guide}</p>
            </Link>
          </li>
        ))}
      </ol>
      {bottleneckNote ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
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
  critical: { bar: 'bg-state-blocked', label: 'text-state-blocked' },
  normal: { bar: 'bg-tag-info', label: 'text-foreground' },
  ample: { bar: 'bg-state-done', label: 'text-state-done' },
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
        <h2 id="dashboard-team-capacity-heading" className="text-base font-bold text-foreground">
          チームの余白
        </h2>
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
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-sm leading-5 text-state-confirm">
          <span>{suggestion}</span>
          <Link
            href="/handoff"
            className="inline-flex items-center rounded border border-state-confirm/40 bg-card px-2 py-0.5 text-xs font-medium text-state-confirm hover:bg-state-confirm/15"
          >
            → ハンドオフへ
          </Link>
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 左サマリーレール
// ---------------------------------------------------------------------------

type DashboardSummaryRailTask = {
  key: string;
  label: string;
  count: number;
  tone: 'normal' | 'warning' | 'urgent' | 'info';
  href: string;
};

function sourceLinkCount(
  sourceLinks: DashboardUrgentSourceLink[],
  source: DashboardUrgentSourceLink['source'],
) {
  return sourceLinks.find((link) => link.source === source)?.total_count ?? 0;
}

function sourceLinkHref(
  sourceLinks: DashboardUrgentSourceLink[],
  source: DashboardUrgentSourceLink['source'],
  fallback: string,
) {
  return sourceLinks.find((link) => link.source === source)?.href ?? fallback;
}

function buildDashboardSummaryRailTasks({
  summary,
  details,
  inbound,
  sourceLinks,
}: {
  summary: DashboardCockpitSummaryResponse;
  details: DashboardCockpitDetailsResponse | null;
  inbound: DashboardCockpitInboundResponse | null;
  sourceLinks: DashboardUrgentSourceLink[];
}): DashboardSummaryRailTask[] {
  const inboundCount =
    inbound?.inbound_needs_review_count ?? sourceLinkCount(sourceLinks, 'inbound');
  const stockCount = sourceLinkCount(sourceLinks, 'medication_stock');
  const reportCount = sourceLinkCount(sourceLinks, 'report');
  const billingCount = sourceLinkCount(sourceLinks, 'billing');

  return [
    {
      key: 'audit',
      label: '監査待ち',
      count: summary.audit_queue_total_count ?? summary.audit_pending_count,
      tone: summary.narcotic_audit_count > 0 ? 'urgent' : 'warning',
      href: sourceLinkHref(sourceLinks, 'audit', '/audit?filter=dashboard_urgent'),
    },
    {
      key: 'visit',
      label: '本日の訪問',
      count: summary.today_visit_count,
      tone: 'info',
      href: '/schedules?date=today',
    },
    {
      key: 'inbound',
      label: '他職種受信',
      count: inboundCount,
      tone: inboundCount > 0 ? 'warning' : 'normal',
      href: DASHBOARD_INBOUND_DRILLDOWN_HREF,
    },
    {
      key: 'stock',
      label: '残数リスク',
      count: stockCount,
      tone: stockCount > 0 ? 'warning' : 'normal',
      href: sourceLinkHref(sourceLinks, 'medication_stock', '/patients?filter=medication_stock'),
    },
    {
      key: 'report',
      label: '報告・請求',
      count: reportCount + billingCount,
      tone: reportCount + billingCount > 0 ? 'warning' : 'normal',
      href:
        reportCount > 0
          ? sourceLinkHref(sourceLinks, 'report', '/reports?status=pending')
          : sourceLinkHref(sourceLinks, 'billing', '/billing?status=pending'),
    },
    {
      key: 'carryover',
      label: '持ち越し',
      count: details?.carryover_count ?? 0,
      tone: (details?.carryover_count ?? 0) > 0 ? 'warning' : 'normal',
      href: DASHBOARD_CARRYOVER_HREF,
    },
  ];
}

function DashboardSummaryRail({
  summary,
  details,
  team,
  inbound,
  sourceLinks,
}: {
  summary: DashboardCockpitSummaryResponse;
  details: DashboardCockpitDetailsResponse | null;
  team: DashboardCockpitTeamResponse | null;
  inbound: DashboardCockpitInboundResponse | null;
  sourceLinks: DashboardUrgentSourceLink[];
}) {
  const waitingReviewCount =
    (summary.audit_queue_total_count ?? summary.audit_pending_count) +
    (inbound?.inbound_needs_review_count ?? sourceLinkCount(sourceLinks, 'inbound'));
  const attentionCount = Math.max((details?.urgent_total_count ?? 0) - waitingReviewCount, 0);
  const stableCount = Math.max(
    Object.values(summary.cycle_status_counts).reduce((total, count) => total + count, 0) -
      waitingReviewCount -
      attentionCount,
    0,
  );
  const taskSummary = buildDashboardSummaryRailTasks({
    summary,
    details,
    inbound,
    sourceLinks,
  });
  const workingMembers = team?.team_capacity.filter((member) => member.status === 'working') ?? [];
  const totalSlackMinutes =
    workingMembers.length > 0
      ? workingMembers.reduce((total, member) => total + (member.slack_minutes ?? 0), 0)
      : null;
  const tightestMember = workingMembers
    .filter((member) => member.slack_minutes != null)
    .sort((left, right) => (left.slack_minutes ?? 0) - (right.slack_minutes ?? 0))[0];
  const bottleneckLabel =
    tightestMember && (tightestMember.slack_minutes ?? 0) < TEAM_SLACK_CRITICAL_MINUTES
      ? `${tightestMember.name.split(/[\s　]+/)[0]}さんの余白が少ない`
      : null;

  return (
    <aside
      aria-labelledby="dashboard-summary-rail-heading"
      className="rounded-lg border border-border/70 bg-card p-4 xl:sticky xl:top-4"
      data-testid="dashboard-summary-rail"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="dashboard-summary-rail-heading" className="text-base font-bold text-foreground">
            今日のサマリー
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            既存の運用segmentから合成しています
          </p>
        </div>
        <DashboardGeneratedAtMeta generatedAt={summary.generated_at} />
      </div>

      <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 xl:grid xl:grid-cols-3 xl:overflow-visible xl:pb-0">
        {[
          { label: '通常運用', value: stableCount, tone: 'bg-state-done/10 text-state-done' },
          {
            label: '要対応',
            value: attentionCount,
            tone: 'bg-state-confirm/10 text-state-confirm',
          },
          {
            label: '確認待ち',
            value: waitingReviewCount,
            tone: 'bg-tag-hazard/10 text-tag-hazard',
          },
        ].map((item) => (
          <div
            key={item.label}
            className="min-w-28 rounded-md border border-border/70 bg-background px-3 py-2"
          >
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p
              className={cn(
                'mt-1 text-2xl font-bold leading-8 tabular-nums',
                item.value > 0 ? item.tone : 'text-foreground',
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-foreground">主なタスク</h3>
        <ul className="mt-2 space-y-1.5" role="list">
          {taskSummary.map((task) => (
            <li key={task.key}>
              <Link
                href={task.href}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border/70 bg-background px-3 py-2 text-sm transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`${task.label}を開く。${task.count}件`}
              >
                <span className="min-w-0 truncate font-medium">{task.label}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                    task.tone === 'urgent'
                      ? 'bg-tag-hazard/10 text-tag-hazard'
                      : task.tone === 'warning'
                        ? 'bg-state-confirm/10 text-state-confirm'
                        : task.tone === 'info'
                          ? 'bg-tag-info/10 text-tag-info'
                          : 'bg-muted text-muted-foreground',
                  )}
                >
                  {task.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 rounded-md border border-border/70 bg-background px-3 py-3">
        <h3 className="text-sm font-semibold text-foreground">チーム状況</h3>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          {totalSlackMinutes == null ? (
            'チーム余白を読み込み中'
          ) : (
            <>
              合計余白{' '}
              <span className="font-bold tabular-nums text-foreground">{totalSlackMinutes}分</span>
            </>
          )}
        </p>
        {bottleneckLabel ? (
          <p className="mt-2 rounded border border-state-confirm/30 bg-state-confirm/10 px-2 py-1.5 text-xs font-semibold text-state-confirm">
            {bottleneckLabel}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function DashboardDetailsLoading({
  auditCount,
  visitCount,
}: {
  auditCount: number;
  visitCount: number;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      role="status"
      aria-label="ダッシュボード詳細を読み込み中"
      data-testid="dashboard-details-loading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-foreground">詳細を読み込み中</h2>
        <p className="text-xs text-muted-foreground">
          監査{auditCount}件・訪問{visitCount}件の明細を後追い取得しています。
        </p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-3 h-28 w-full rounded-lg" />
    </section>
  );
}

function DashboardDetailsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      data-testid="dashboard-details-error"
    >
      <SegmentError
        title="対応詳細を表示できません"
        cause="監査キューと今日の訪問明細だけ取得に失敗しました。"
        nextAction="概要は表示したまま、詳細セクションだけ再試行できます。"
        detail={error instanceof Error ? error.message : undefined}
        onRetry={onRetry}
        retryLabel="再試行"
        metadata={{ route: '/api/dashboard/cockpit/details' }}
      />
    </section>
  );
}

function TeamCapacityLoading() {
  return (
    <section
      aria-label="チーム状況を読み込み中"
      className="rounded-lg border border-border/70 bg-card p-4"
      role="status"
      data-testid="dashboard-team-loading"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-bold text-foreground">チームの余白</h2>
        <p className="text-xs text-muted-foreground">詳細を読み込み中</p>
      </div>
      <div className="mt-3 space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full rounded-md" />
        ))}
      </div>
    </section>
  );
}

function TeamCapacityError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      data-testid="dashboard-team-error"
    >
      <SegmentError
        title="チーム状況を表示できません"
        cause="担当者の余白だけ取得に失敗しました。"
        nextAction="工程状況は表示したまま、チーム状況だけ再試行できます。"
        detail={error instanceof Error ? error.message : undefined}
        onRetry={onRetry}
        retryLabel="再試行"
        metadata={{ route: '/api/dashboard/cockpit/team' }}
      />
    </section>
  );
}

function ActionRailLoading() {
  return (
    <aside
      className="rounded-lg border border-border/70 bg-card p-4"
      role="status"
      aria-label="右レールを読み込み中"
      data-testid="dashboard-action-rail-loading"
    >
      <div className="space-y-3">
        <Skeleton className="h-5 w-28 rounded-md" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-5 w-32 rounded-md" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-5 w-24 rounded-md" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </aside>
  );
}

function formatCommentTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'HH:mm');
}

function commentBadge(comment: CockpitCommentItem) {
  if (comment.mentions_me) {
    return { label: '自分宛', className: 'bg-state-confirm/10 text-state-confirm' };
  }
  if (comment.authored_by_me) {
    return { label: '自分の投稿', className: 'bg-tag-info/10 text-tag-info' };
  }
  return { label: '共有', className: 'bg-muted text-muted-foreground' };
}

function TeamConversationPanel({
  comments,
  hiddenCount,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  comments: CockpitCommentItem[];
  hiddenCount: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <section
        aria-label="チームの会話を読み込み中"
        className="rounded-lg border border-border/70 bg-card p-4"
        role="status"
        data-testid="dashboard-comments-loading"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">チームの会話</h3>
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-md" />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        data-testid="dashboard-comments-error"
      >
        <SegmentError
          title="チームの会話を表示できません"
          cause="コメントだけ取得に失敗しました。"
          nextAction="次にやることと止まっている理由は表示したまま、チームの会話だけ再試行できます。"
          detail={error instanceof Error ? error.message : undefined}
          onRetry={onRetry}
          retryLabel="再試行"
          metadata={{ route: '/api/dashboard/cockpit/comments' }}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="dashboard-team-conversation-heading"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
      data-testid="dashboard-comments-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h3
              id="dashboard-team-conversation-heading"
              className="text-sm font-semibold text-foreground"
            >
              チームの会話
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              コメントから該当作業へ移動します
            </p>
          </div>
        </div>
        <Link
          href={DASHBOARD_COMMENTS_DRILLDOWN_HREF}
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          すべて見る
        </Link>
      </div>
      {comments.length === 0 ? (
        <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-4 text-sm leading-6 text-muted-foreground">
          直近のコメントはありません。
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {comments.map((comment) => {
            const badge = commentBadge(comment);
            return (
              <li key={comment.id} className="rounded-md border border-border/70 bg-background p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {comment.entity_label}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatCommentTimestamp(comment.created_at)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-foreground">
                  {comment.content_excerpt}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {comment.author_name}
                  </span>
                  <Link
                    href={comment.href}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    開く
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <Link
          href={DASHBOARD_COMMENTS_DRILLDOWN_HREF}
          className="inline-flex text-xs font-medium leading-5 text-primary hover:underline"
        >
          他{hiddenCount}件をハンドオフで見る
        </Link>
      ) : null}
    </section>
  );
}

function inboundPriorityBadge(item: CockpitInboundItem) {
  if (item.priority === 'urgent') {
    return { label: '安全確認', className: 'bg-destructive/10 text-destructive' };
  }
  if (item.has_medication_stock_signal) {
    return { label: '残数・薬剤', className: 'bg-state-confirm/10 text-state-confirm' };
  }
  return { label: '受信', className: 'bg-tag-info/10 text-tag-info' };
}

function inboundStatusLabel(status: CockpitInboundItem['status']) {
  switch (status) {
    case 'needs_review':
      return '確認待ち';
    case 'reviewed_pending_action':
      return '反映待ち';
    case 'task_created':
      return 'タスク化済み';
    case 'task_completed':
      return '処理済み';
    default:
      return status;
  }
}

function InboundFeedPanel({
  items,
  hiddenCount,
  needsReviewCount,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  items: CockpitInboundItem[];
  hiddenCount: number;
  needsReviewCount: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <section
        aria-label="他職種受信を読み込み中"
        className="rounded-lg border border-border/70 bg-card p-4"
        role="status"
        data-testid="dashboard-inbound-loading"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">他職種受信</h3>
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-md" />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        data-testid="dashboard-inbound-error"
      >
        <SegmentError
          title="他職種受信を表示できません"
          cause="MCS・電話・FAX・メールの受信情報だけ取得に失敗しました。"
          nextAction="監査・訪問・工程状況は表示したまま、受信情報だけ再試行できます。"
          detail={error instanceof Error ? error.message : undefined}
          onRetry={onRetry}
          retryLabel="再試行"
          metadata={{ route: '/api/dashboard/cockpit/inbound' }}
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="dashboard-inbound-heading"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4"
      data-testid="dashboard-inbound-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="dashboard-inbound-heading" className="text-sm font-semibold text-foreground">
              他職種受信
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              MCS・電話・FAX・メールから薬局業務へ変換します
            </p>
          </div>
        </div>
        <Link
          href={DASHBOARD_INBOUND_DRILLDOWN_HREF}
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          すべて見る
        </Link>
      </div>
      {needsReviewCount > 0 ? (
        <p className="rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-xs font-semibold text-state-confirm">
          確認待ち {needsReviewCount}件
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-4 text-sm leading-6 text-muted-foreground">
          未処理の他職種受信はありません。
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {items.map((item) => {
            const badge = inboundPriorityBadge(item);
            const signalSummary = item.signals
              .map((signal) =>
                signal.extracted_medication_name
                  ? `${signal.extracted_medication_name}${
                      signal.extracted_quantity != null && signal.extracted_unit
                        ? ` ${signal.extracted_quantity}${signal.extracted_unit}`
                        : ''
                    }`
                  : null,
              )
              .filter((value): value is string => Boolean(value))
              .slice(0, 2)
              .join(' / ');
            return (
              <li key={item.id} className="rounded-md border border-border/70 bg-background p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {item.channel_label}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {inboundStatusLabel(item.status)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatCommentTimestamp(item.received_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold leading-5 text-foreground">
                  {item.patient_name ? `${item.patient_name} 様` : '患者未紐づけ'}
                </p>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-foreground">
                  {item.summary}
                </p>
                {signalSummary ? (
                  <p className="mt-1 text-xs font-medium leading-5 text-state-confirm">
                    {signalSummary}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {[item.sender_role, item.sender_name, item.sender_organization_name]
                      .filter(Boolean)
                      .join(' / ')}
                  </span>
                  <Link
                    href={item.action_href}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    {item.action_label}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <Link
          href={DASHBOARD_INBOUND_DRILLDOWN_HREF}
          className="inline-flex text-xs font-medium leading-5 text-primary hover:underline"
        >
          他{hiddenCount}件を受信インボックスで見る
        </Link>
      ) : null}
    </section>
  );
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

export function DashboardCockpit({ focusRole = 'common' }: { focusRole?: DashboardFocusRole }) {
  const orgId = useOrgId();
  const [viewScope, setViewScope] = useState<DashboardViewScope>('mine');
  const isBootstrappingOrg = !orgId;

  const summaryQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', 'summary', orgId, viewScope],
    queryFn: () => fetchDashboardCockpitSummary(orgId, viewScope),
    staleTime: COCKPIT_FRESHNESS_WINDOW_MS,
    enabled: !isBootstrappingOrg,
    invalidateOn: DASHBOARD_SUMMARY_REALTIME_EVENTS,
  });
  const summary = summaryQuery.data ?? null;
  const segmentQueriesEnabled = !isBootstrappingOrg && summary != null;
  const detailsQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', 'details', orgId, viewScope],
    queryFn: () => fetchDashboardCockpitDetails(orgId, viewScope),
    staleTime: COCKPIT_FRESHNESS_WINDOW_MS,
    enabled: segmentQueriesEnabled,
    invalidateOn: DASHBOARD_DETAILS_REALTIME_EVENTS,
  });
  const teamQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', 'team', orgId, viewScope],
    queryFn: () => fetchDashboardCockpitTeam(orgId, viewScope),
    staleTime: COCKPIT_FRESHNESS_WINDOW_MS,
    enabled: segmentQueriesEnabled,
    invalidateOn: DASHBOARD_TEAM_REALTIME_EVENTS,
  });
  const commentsQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', 'comments', orgId, viewScope],
    queryFn: () => fetchDashboardCockpitComments(orgId, viewScope),
    staleTime: COCKPIT_FRESHNESS_WINDOW_MS,
    enabled: segmentQueriesEnabled,
    invalidateOn: ['comment_refresh'],
  });
  const inboundQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', 'inbound', orgId, viewScope],
    queryFn: () => fetchDashboardCockpitInbound(orgId, viewScope),
    staleTime: COCKPIT_FRESHNESS_WINDOW_MS,
    enabled: segmentQueriesEnabled,
    invalidateOn: DASHBOARD_INBOUND_REALTIME_EVENTS,
  });

  const details = detailsQuery.data ?? null;
  const team = teamQuery.data ?? null;
  const comments = commentsQuery.data ?? null;
  const inbound = inboundQuery.data ?? null;
  const viewModel = useDashboardCockpitViewModel({
    summary,
    details,
    team,
    comments,
    inbound,
    requestedScope: viewScope,
  });
  const hasStaleRefetchError =
    (summary != null && (summaryQuery.isRefetchError || summaryQuery.isError)) ||
    (details != null && (detailsQuery.isRefetchError || detailsQuery.isError)) ||
    (team != null && (teamQuery.isRefetchError || teamQuery.isError)) ||
    (comments != null && (commentsQuery.isRefetchError || commentsQuery.isError)) ||
    (inbound != null && (inboundQuery.isRefetchError || inboundQuery.isError));
  const evidence: EvidenceItem[] = viewModel.evidence.map((item) =>
    item.id === 'sync'
      ? {
          ...item,
          meta: summary ? <DashboardGeneratedAtMeta generatedAt={summary.generated_at} /> : '—',
          onView: () => void summaryQuery.refetch(),
        }
      : item,
  );
  const detailsReady = details != null;
  const detailsInitialError = !detailsReady && detailsQuery.isError;
  const detailsInitialLoading =
    !detailsReady && (detailsQuery.isLoading || summary != null) && !detailsInitialError;
  const teamReady = team != null;
  const teamInitialError = !teamReady && teamQuery.isError;
  const teamInitialLoading =
    !teamReady && (teamQuery.isLoading || summary != null) && !teamInitialError;
  const commentsReady = comments != null;
  const commentsInitialError = !commentsReady && commentsQuery.isError;
  const commentsInitialLoading =
    !commentsReady && (commentsQuery.isLoading || summary != null) && !commentsInitialError;
  const inboundReady = inbound != null;
  const inboundInitialError = !inboundReady && inboundQuery.isError;
  const inboundInitialLoading =
    !inboundReady && (inboundQuery.isLoading || summary != null) && !inboundInitialError;

  return (
    <section aria-label="運用コックピット" data-testid="dashboard-cockpit">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">ダッシュボード</h1>
          <DashboardHeaderClock scopeLabel={viewModel.scopeLabel} />
          <p className="text-xs font-medium text-muted-foreground">{FOCUS_ROLE_HINT[focusRole]}</p>
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
              option.value === 'team' && !viewModel.canViewTeam
                ? {
                    ...option,
                    disabled: true,
                    disabledReason: 'チーム全体は管理者だけが表示できます',
                  }
                : option,
            )}
            value={viewModel.appliedScope}
            onChange={setViewScope}
            ariaLabel="表示範囲の切替"
          />
        </div>
      </div>
      {summary?.scope?.applied === 'mine' && !summary.scope.can_view_team ? (
        <p className="mt-2 text-xs text-muted-foreground">
          この画面は担当患者・担当ケースの範囲で集計しています。チーム全体の集計は管理者だけが表示できます。
        </p>
      ) : null}

      <div className="mt-4">
        {isBootstrappingOrg || summaryQuery.isLoading ? (
          <CockpitSkeleton />
        ) : !summary ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <SegmentError
              title="ダッシュボードを表示できません"
              cause="運用コックピットの集計取得に失敗しました。"
              nextAction="再試行して、概要から読み込み直してください。"
              detail={summaryQuery.error instanceof Error ? summaryQuery.error.message : undefined}
              onRetry={() => void summaryQuery.refetch()}
              retryLabel="再試行"
              metadata={{ route: '/api/dashboard/cockpit/summary' }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {hasStaleRefetchError ? (
              <SegmentStaleBanner
                title="前回取得時点の情報を表示中"
                description="最新化に失敗しました。表示中の情報は前回取得時点のものです。"
                retryLabel="再試行"
                metadata={{ generatedAt: summary.generated_at }}
                onRetry={() => {
                  void summaryQuery.refetch();
                  void detailsQuery.refetch();
                  void teamQuery.refetch();
                  void commentsQuery.refetch();
                  void inboundQuery.refetch();
                }}
              />
            ) : null}
            <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(300px,360px)]">
              <DashboardSummaryRail
                summary={summary}
                details={details}
                team={team}
                inbound={inbound}
                sourceLinks={viewModel.urgentSourceLinks}
              />
              <div className="min-w-0 space-y-4">
                <ConditionBanner data={summary} />
                {detailsReady ? (
                  <>
                    <UrgentNowSection
                      items={viewModel.urgentItems}
                      sourceLinks={viewModel.urgentSourceLinks}
                      totalCount={viewModel.urgentTotalCount}
                    />
                    <TodayFlowSection
                      visits={viewModel.todayVisits}
                      auditCount={summary.audit_pending_count}
                      narcoticAuditCount={summary.narcotic_audit_count}
                      reportCount={summary.cycle_status_counts['visit_completed'] ?? 0}
                    />
                  </>
                ) : detailsInitialError ? (
                  <DashboardDetailsError
                    error={detailsQuery.error}
                    onRetry={() => void detailsQuery.refetch()}
                  />
                ) : detailsInitialLoading ? (
                  <DashboardDetailsLoading
                    auditCount={summary.audit_pending_count}
                    visitCount={summary.today_visit_count}
                  />
                ) : null}
                <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
                  <ProcessNowSection tiles={viewModel.processTiles} />
                  {teamReady ? (
                    <TeamCapacityCard
                      team={team.team_capacity ?? []}
                      suggestion={viewModel.teamHandoffSuggestion}
                    />
                  ) : teamInitialError ? (
                    <TeamCapacityError
                      error={teamQuery.error}
                      onRetry={() => void teamQuery.refetch()}
                    />
                  ) : teamInitialLoading ? (
                    <TeamCapacityLoading />
                  ) : null}
                </div>
              </div>
              {/*
               * 右レールはデザイン 01 の 3 点セットに、横断コメント feed を
               * TeamConversationPanel として fail-soft に追加する。
               */}
              <div className="min-w-0">
                {detailsReady ? (
                  <WorkspaceActionRail
                    nextAction={viewModel.nextAction}
                    blockedReasons={viewModel.blockedReasons}
                    blockedReasonsEmptyLabel="止まっている作業はありません"
                    evidence={evidence}
                    evidenceOpenLabel="開く"
                  >
                    <InboundFeedPanel
                      items={inbound?.inbound_items ?? []}
                      hiddenCount={viewModel.inboundHiddenCount}
                      needsReviewCount={viewModel.inboundNeedsReviewCount}
                      isLoading={inboundInitialLoading}
                      isError={inboundInitialError}
                      error={inboundQuery.error}
                      onRetry={() => void inboundQuery.refetch()}
                    />
                    <TeamConversationPanel
                      comments={comments?.comments ?? []}
                      hiddenCount={viewModel.commentsHiddenCount}
                      isLoading={commentsInitialLoading}
                      isError={commentsInitialError}
                      error={commentsQuery.error}
                      onRetry={() => void commentsQuery.refetch()}
                    />
                  </WorkspaceActionRail>
                ) : detailsInitialError ? null : (
                  <ActionRailLoading />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
