'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Lock, Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { DayBoardPendingProposal, ScheduleDayBoardResponse } from '@/types/schedule-day-board';
import {
  BOARD_END_MINUTES,
  BOARD_START_MINUTES,
  boardPercent,
  buildScheduleRiskAlert,
  buildStaffLane,
  formatTimeOfDayIso,
  pendingProposalDateLabel,
  type BoardBlock,
  type StaffLane,
} from './schedule-team-board.helpers';

/**
 * new_03_schedule(docs/design-gap-analysis-new.md 03_schedule)の全員スケジュールボード。
 * 見出し帯(日/週トグル) → 今日のスケジュール — 全員(薬剤師/事務の横型ガント+余白)
 * → リスク警告 → 未確定、右レールに 次にやること/止まっている理由/根拠・記録。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 * 旧 day-view の操作群はページ下部(#schedule-legacy-tools)へ温存する。
 */

async function fetchScheduleDayBoard(
  orgId: string,
  date: string,
): Promise<ScheduleDayBoardResponse> {
  const res = await fetch(`/api/visit-schedules/day-board?date=${date}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('全員スケジュールの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function fetchCockpitForRail(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日の優先タスク取得に失敗しました');
  const json = await res.json();
  return json.data;
}

/** 経過分 → 「30分」「2時間」「1日」(止まっている理由の経過時間)。 */
function formatAgeLabel(minutes: number): string {
  const safeMinutes = Math.max(minutes, 0);
  if (safeMinutes < 60) return `${safeMinutes}分`;
  if (safeMinutes < 24 * 60) return `${Math.floor(safeMinutes / 60)}時間`;
  return `${Math.floor(safeMinutes / (24 * 60))}日`;
}

function familyName(name: string): string {
  return name.split(/[\s　]+/)[0] || name;
}

// ---------------------------------------------------------------------------
// 日/週トグル(日=当日ガント / 週=カレンダー)
// ---------------------------------------------------------------------------

export function ScheduleViewModeToggle({
  activeView,
  date,
}: {
  activeView: 'list' | 'calendar';
  date: string;
}) {
  const options = [
    { key: 'list' as const, label: '日', href: `/schedules?view=list&date=${date}` },
    { key: 'calendar' as const, label: '週', href: '/schedules?view=calendar' },
  ];
  return (
    <div
      role="group"
      aria-label="日/週の切替"
      className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-card p-0.5"
      data-testid="schedule-view-mode-toggle"
    >
      {options.map((option) => {
        const isActive = option.key === activeView;
        return (
          <Link
            key={option.key}
            href={option.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-[44px] min-w-12 items-center justify-center rounded px-3 text-sm font-semibold transition-colors sm:min-h-9',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ガント(全員)
// ---------------------------------------------------------------------------

const BLOCK_KIND_CLASSES: Record<BoardBlock['kind'], string> = {
  visit: 'bg-emerald-600 text-white',
  desk: 'bg-primary text-primary-foreground',
  prep: 'bg-amber-500 text-white',
  travel:
    'bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_4px,#cbd5e1_4px,#cbd5e1_8px)] text-transparent',
  break: 'border border-dashed border-border bg-muted/40 text-muted-foreground',
  idle: 'border border-dashed border-emerald-400 bg-emerald-50/50 text-emerald-700',
};

function blockClassName(block: BoardBlock): string {
  if (block.kind === 'visit') {
    if (block.risk) return 'bg-emerald-600 text-white ring-2 ring-amber-400';
    return BLOCK_KIND_CLASSES.visit;
  }
  return BLOCK_KIND_CLASSES[block.kind];
}

function GanttBlock({ block }: { block: BoardBlock }) {
  const left = boardPercent(block.startMinutes);
  const width = Math.max(boardPercent(block.endMinutes) - left, 1.5);
  return (
    <li
      data-kind={block.kind}
      title={block.label}
      className={cn(
        'absolute inset-y-1 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1.5 text-[11px] font-medium',
        blockClassName(block),
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      {block.locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className={cn('truncate', block.kind === 'travel' && 'sr-only')}>{block.label}</span>
      {block.risk ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : null}
      {block.locked ? <span className="sr-only">(確定・変更は理由必須)</span> : null}
    </li>
  );
}

function GanttRow({ lane }: { lane: StaffLane }) {
  return (
    <div
      className="grid grid-cols-[88px_minmax(0,1fr)_92px] items-center gap-2"
      data-testid="team-board-row"
    >
      <p className="truncate text-sm font-semibold text-foreground">{lane.rowLabel}</p>
      <ol
        aria-label={`${lane.rowLabel}の今日の予定`}
        className="relative h-11 rounded-md border border-border/60 bg-muted/20"
      >
        {lane.blocks.map((block) => (
          <GanttBlock key={block.id} block={block} />
        ))}
      </ol>
      <p
        className={cn(
          'flex items-center justify-end gap-0.5 text-xs font-bold tabular-nums',
          lane.idleTone === 'tight' ? 'text-red-600' : 'text-emerald-700',
        )}
        data-testid="team-board-idle"
      >
        余白 {lane.idleMinutes}分
        {lane.idleTone === 'tight' ? (
          <AlertTriangle className="size-3.5" aria-hidden="true" />
        ) : null}
      </p>
    </div>
  );
}

function TeamGanttCard({
  board,
  cockpit,
  dateLabel,
  now,
}: {
  board: ScheduleDayBoardResponse;
  cockpit: DashboardCockpitResponse | null;
  dateLabel: string;
  now: Date;
}) {
  const riskPatientNames = new Set(
    (cockpit?.audit_queue ?? [])
      .filter((item) => item.has_narcotic)
      .map((item) => item.patient_name),
  );
  const clericalBlockedCount = (cockpit?.blocked_reasons ?? []).filter(
    (reason) => reason.category === '事務',
  ).length;

  const firstPharmacistId = board.staff.find((member) => member.role_kind === 'pharmacist')?.id;
  const lanes = board.staff.map((member) =>
    buildStaffLane({
      staff: member,
      riskPatientNames,
      reportPendingCount: member.id === firstPharmacistId ? board.report_pending_count : 0,
      clericalBlockedCount,
    }),
  );

  const riskAlert = cockpit
    ? buildScheduleRiskAlert({ auditQueue: cockpit.audit_queue, staff: board.staff })
    : null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowMarker = nowMinutes >= BOARD_START_MINUTES && nowMinutes <= BOARD_END_MINUTES;
  const nowLabel = `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`;
  const hourLabels: string[] = [];
  for (let minutes = BOARD_START_MINUTES; minutes <= BOARD_END_MINUTES; minutes += 60) {
    hourLabels.push(`${Math.floor(minutes / 60)}:00`);
  }

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="team-board-heading"
      data-testid="schedule-team-gantt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="team-board-heading" className="text-base font-bold text-foreground">
          今日のスケジュール — 全員
        </h3>
        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
          {dateLabel}
        </span>
        <Link
          href="#planner"
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'ml-auto' })}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          予定を作る
        </Link>
      </div>

      {lanes.length === 0 ? (
        <p className="mt-4 rounded-md border border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          表示できる担当者がいません。スタッフ登録後に全員のスケジュールが並びます。
        </p>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-[88px_minmax(0,1fr)_92px] gap-2">
            <span aria-hidden="true" />
            <div
              aria-hidden="true"
              className="flex justify-between text-[10px] text-muted-foreground"
            >
              {hourLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <span aria-hidden="true" />
          </div>
          <div className="relative mt-1 space-y-2">
            {lanes.map((lane) => (
              <GanttRow key={lane.staffId} lane={lane} />
            ))}
            {showNowMarker ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-red-500"
                style={{
                  left: `calc(88px + 0.5rem + (100% - 88px - 92px - 1rem) * ${boardPercent(nowMinutes) / 100})`,
                }}
                data-testid="team-board-now-line"
              />
            ) : null}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden="true" />
              ＝確定(変更は理由必須)
            </span>
            <span>斜線＝移動時間</span>
            <span>緑点線＝余白</span>
            {showNowMarker ? (
              <span className="font-semibold text-red-600">|＝いま {nowLabel}</span>
            ) : null}
          </p>
        </div>
      )}

      {riskAlert ? (
        <div
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5"
          role="alert"
          data-testid="schedule-risk-banner"
        >
          <p className="flex items-start gap-2 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              <strong className="font-bold">リスクのある予定:</strong>
              {riskAlert.message.replace(/^リスクのある予定:/, '')}
            </span>
          </p>
          <Link
            href={riskAlert.actionHref}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'mt-2 bg-card',
            })}
          >
            {riskAlert.actionLabel}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 未確定(受入判断・仮枠)
// ---------------------------------------------------------------------------

function PendingProposalRow({
  proposal,
  todayKey,
}: {
  proposal: DayBoardPendingProposal;
  todayKey: string;
}) {
  const dateLabel = pendingProposalDateLabel(proposal.proposed_date, todayKey);
  const timeLabel = proposal.time_start ? formatTimeOfDayIso(proposal.time_start) : '時間未定';
  const pharmacistLabel = proposal.pharmacist_name
    ? `仮枠(${familyName(proposal.pharmacist_name)})`
    : '仮枠';
  const showImpact =
    proposal.idle_before_minutes != null &&
    proposal.idle_after_minutes != null &&
    proposal.pharmacist_name != null;

  return (
    <li
      className="rounded-md border border-amber-200/80 bg-amber-50/40 px-3 py-2.5"
      data-testid="pending-proposal-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
          {proposal.badge_label}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
          {proposal.badge_label === '受入判断' ? '新規 ' : ''}
          {proposal.patient_name}様 — {dateLabel} {timeLabel} {pharmacistLabel}
        </p>
        {proposal.response_due_at ? (
          <span className="shrink-0 text-sm font-bold text-amber-700">
            返答期限 {formatTimeOfDayIso(proposal.response_due_at)}
          </span>
        ) : null}
        <Link
          href="/dashboard"
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'shrink-0 bg-card',
          })}
        >
          → ダッシュボードへ
        </Link>
      </div>
      {showImpact ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          確定すると{familyName(proposal.pharmacist_name as string)}さんの{dateLabel}の余白は{' '}
          {proposal.idle_before_minutes}分 → {proposal.idle_after_minutes}分 になります
        </p>
      ) : null}
    </li>
  );
}

function PendingProposalsCard({
  proposals,
  todayKey,
}: {
  proposals: DayBoardPendingProposal[];
  todayKey: string;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="pending-proposals-heading"
      data-testid="schedule-pending-proposals"
    >
      <div className="flex items-baseline gap-2">
        <h3 id="pending-proposals-heading" className="text-base font-bold text-foreground">
          未確定
        </h3>
        <span className="text-xs text-muted-foreground">{proposals.length}件</span>
      </div>
      {proposals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          受入判断・仮枠の未確定予定はありません。
        </p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {proposals.map((proposal) => (
            <PendingProposalRow key={proposal.id} proposal={proposal} todayKey={todayKey} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 右レール(次にやること / 止まっている理由 / 根拠・記録)
// ---------------------------------------------------------------------------

function buildNextAction(
  cockpit: DashboardCockpitResponse | null,
  board: ScheduleDayBoardResponse | null,
): NextActionPanelProps {
  const topAudit = cockpit?.audit_queue[0] ?? null;
  if (topAudit) {
    const auditLabel = topAudit.has_narcotic ? '麻薬監査' : '監査';
    const riskVisit = board?.staff
      .flatMap((member) => member.visits)
      .find((visit) => visit.time_start && visit.patient_name === topAudit.patient_name);
    return {
      actionLabel: topAudit.due_at
        ? `${auditLabel}を開始 — ${formatTimeOfDayIso(topAudit.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: riskVisit?.time_start
        ? `${formatTimeOfDayIso(riskVisit.time_start)}訪問(${topAudit.patient_name}様)の持参薬です。完了で午後の予定がすべて確定します。`
        : `${topAudit.patient_name}様の${auditLabel}が待ちです。完了で今後の予定が確定します。`,
      actionHref: '/auditing',
    };
  }
  return {
    actionLabel: '訪問準備を確認する',
    description: 'いま期限で止まっている監査はありません。今日の訪問準備を確認します。',
    actionHref: '#schedule-legacy-tools',
  };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]"
      role="status"
      aria-label="スケジュール読み込み中"
    >
      <div className="space-y-4">
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export type ScheduleTeamBoardProps = {
  /** YYYY-MM-DD(未指定は今日) */
  initialDate?: string;
  activeView: 'list' | 'calendar';
};

export function ScheduleTeamBoard({ initialDate, activeView }: ScheduleTeamBoardProps) {
  const orgId = useOrgId();
  const now = new Date();
  const todayKey = format(now, 'yyyy-MM-dd');
  const dateKey = initialDate ?? todayKey;
  const boardDate = new Date(`${dateKey}T00:00:00`);
  const dateLabel = format(boardDate, 'M/d(EEE)', { locale: ja });

  const boardQuery = useQuery({
    queryKey: ['schedule-day-board', orgId, dateKey],
    queryFn: () => fetchScheduleDayBoard(orgId, dateKey),
    enabled: Boolean(orgId) && activeView === 'list',
    staleTime: 30_000,
  });
  const cockpitQuery = useQuery({
    queryKey: ['schedule-rail-cockpit', orgId],
    queryFn: () => fetchCockpitForRail(orgId),
    enabled: Boolean(orgId) && activeView === 'list',
    staleTime: 30_000,
  });

  const board = boardQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;

  const blockedReasons: BlockedReason[] = (cockpit?.blocked_reasons ?? []).map((reason) => ({
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
      id: 'travel-evidence',
      label: '移動時間の根拠',
      meta: board ? `ルート計算 ${formatTimeOfDayIso(board.generated_at)}` : undefined,
      href: '#schedule-legacy-tools',
    },
    {
      id: 'confirm-rule',
      label: '確定ルール',
      meta: '変更は理由必須',
      href: '/schedules/proposals',
    },
  ];

  return (
    <section aria-label="スケジュールボード" data-testid="schedule-team-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">スケジュール</h2>
          <p className="text-sm text-muted-foreground">
            {dateLabel} — 訪問は固定点・仕事はその間を流れる
          </p>
        </div>
        <ScheduleViewModeToggle activeView={activeView} date={dateKey} />
      </div>

      {activeView !== 'list' ? null : (
        <div className="mt-4">
          {!orgId || boardQuery.isLoading ? (
            <BoardSkeleton />
          ) : boardQuery.isError || !board ? (
            <div className="rounded-lg border border-border/70 bg-card p-4">
              <ErrorState
                variant="server"
                title="スケジュールを表示できません"
                description="全員スケジュールの取得に失敗しました。再試行してください。"
                detail={boardQuery.error instanceof Error ? boardQuery.error.message : undefined}
                action={{ label: '再試行', onClick: () => void boardQuery.refetch() }}
              />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
              <div className="min-w-0 space-y-4">
                <TeamGanttCard board={board} cockpit={cockpit} dateLabel={dateLabel} now={now} />
                <PendingProposalsCard proposals={board.pending_proposals} todayKey={todayKey} />
              </div>
              <div className="space-y-4">
                <WorkspaceActionRail
                  nextAction={buildNextAction(cockpit, board)}
                  blockedReasons={blockedReasons}
                  blockedReasonsEmptyLabel="止まっている作業はありません"
                  evidence={evidence}
                  evidenceOpenLabel="開く"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
