'use client';

import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  PhoneCall,
  Route,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/loading';
import { ScheduleMetricCard } from '@/app/(dashboard)/schedules/schedule-metric-card';
import {
  CONTACT_STATUS_LABELS,
  countCompletedPreparationItems,
  PRIORITY_LABELS,
  priorityBadgeClass,
  PROPOSAL_STATUS_LABELS,
  SCHEDULE_STATUS_LABELS,
  statusBadgeClass,
  timeLabel,
  type Proposal,
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import type { DashboardFocusRole } from './dashboard-role-focus';
import {
  buildProposalBoardHref,
  countProposalsByReason,
  countSchedulesByReason,
  countSchedulesByStatus,
  countCoordinationProposalsByFilter,
  resolveProposalPriorityReasons,
  resolveProposalPrimaryAction,
  resolveSchedulePriorityReasons,
  resolveSchedulePrimaryAction,
  resolveScheduleSecondaryAction,
  scheduleHasTimingGap,
  scheduleNeedsPreparation,
  type HomePriorityReason,
  type HomeProposalFilter,
  type HomeProposalReasonKey,
  type HomeScheduleReasonKey,
  type HomeVisitScope,
  type HomeVisitStatusFilter,
} from './home-schedule-board.helpers';

export function HomeScheduleBoardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="ホームスケジュール読み込み中">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <Skeleton className="h-80 w-full rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function SectionShell({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border/70 bg-card', className)}>
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PriorityMetricFrame({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <div className={cn(active ? 'rounded-xl ring-2 ring-primary/25' : null)}>{children}</div>;
}

export const VISIT_STATUS_FILTER_OPTIONS: Array<{
  key: HomeVisitStatusFilter;
  label: string;
}> = [
  { key: 'all', label: '全て' },
  { key: 'before_departure', label: '出発前' },
  { key: 'ready_to_depart', label: '出発待ち' },
  { key: 'in_progress', label: '訪問中' },
];

export const PROPOSAL_FILTER_OPTIONS: Array<{
  key: HomeProposalFilter;
  label: string;
}> = [
  { key: 'all', label: '全て' },
  { key: 'pending', label: '未架電' },
  { key: 'change_requested', label: '変更希望' },
  { key: 'reschedule', label: '再調整' },
];

export function InlineFilterButton({
  active,
  label,
  onClick,
  count,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function reasonToneClass(tone: HomePriorityReason['tone']) {
  switch (tone) {
    case 'danger':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
}

function ReasonFilterChip({
  reason,
  count,
  active,
  onClick,
}: {
  reason: HomePriorityReason;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2 py-1 font-medium transition-colors',
        reasonToneClass(reason.tone),
        active ? 'ring-2 ring-primary/25' : null,
      )}
    >
      {reason.label} {count}
    </button>
  );
}

function ReasonFilterRow({
  children,
  label = '優先理由',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function HomeScheduleMetricsSection({
  focusRole,
  metrics,
}: {
  focusRole: DashboardFocusRole;
  metrics: {
    totalVisits: number;
    preparationPending: number;
    timingGaps: number;
    coordinationPending: number;
  };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <PriorityMetricFrame active={focusRole === 'common'}>
        <ScheduleMetricCard
          title="今日の訪問"
          value={metrics.totalVisits}
          description="本日中に実行または確認が必要な訪問予定です。"
          icon={CalendarDays}
        />
      </PriorityMetricFrame>
      <PriorityMetricFrame active={focusRole === 'pharmacist'}>
        <ScheduleMetricCard
          title="準備未完了"
          value={metrics.preparationPending}
          description={
            focusRole === 'pharmacist'
              ? '薬剤師向けに強調しています。出発前に確認が必要です。'
              : '出発前の準備チェックが未完了の訪問です。'
          }
          icon={ClipboardCheck}
        />
      </PriorityMetricFrame>
      <PriorityMetricFrame active={focusRole === 'common'}>
        <ScheduleMetricCard
          title="時間未確定"
          value={metrics.timingGaps}
          description="時間枠が不足しており、当日判断に影響する予定です。"
          icon={CalendarClock}
        />
      </PriorityMetricFrame>
      <PriorityMetricFrame active={focusRole === 'clerk'}>
        <ScheduleMetricCard
          title="連絡・再調整"
          value={metrics.coordinationPending}
          description={
            focusRole === 'clerk'
              ? '事務スタッフ向けに強調しています。架電や再調整が必要です。'
              : '患者連絡や再調整が必要な提案です。'
          }
          icon={PhoneCall}
        />
      </PriorityMetricFrame>
    </div>
  );
}

export function HomeVisitsSection({
  focusRole,
  currentUserId,
  allSchedules,
  scopedSchedules,
  statusScopedSchedules,
  schedules,
  visitScope,
  visitStatusFilter,
  scheduleReasonFilter,
  onVisitScopeChange,
  onVisitStatusFilterChange,
  onScheduleReasonFilterChange,
}: {
  focusRole: DashboardFocusRole;
  currentUserId: string | null;
  allSchedules: VisitSchedule[];
  scopedSchedules: VisitSchedule[];
  statusScopedSchedules: VisitSchedule[];
  schedules: VisitSchedule[];
  visitScope: HomeVisitScope;
  visitStatusFilter: HomeVisitStatusFilter;
  scheduleReasonFilter: HomeScheduleReasonKey | 'all';
  onVisitScopeChange: (scope: HomeVisitScope) => void;
  onVisitStatusFilterChange: (filter: HomeVisitStatusFilter) => void;
  onScheduleReasonFilterChange: (filter: HomeScheduleReasonKey | 'all') => void;
}) {
  return (
    <SectionShell
      title={focusRole === 'pharmacist' ? '今日の訪問実行' : '今日の訪問予定'}
      description={
        focusRole === 'pharmacist'
          ? '時間、準備状況、優先度を上から確認し、そのまま訪問記録へ進みます。'
          : '今日の訪問順と状態を確認し、現場実行や個別確認に進みます。'
      }
    >
      {focusRole === 'pharmacist' && currentUserId ? (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="訪問表示範囲">
          <InlineFilterButton
            active={visitScope === 'mine'}
            label="自分担当"
            count={allSchedules.filter((schedule) => schedule.pharmacist_id === currentUserId).length}
            onClick={() => onVisitScopeChange('mine')}
          />
          <InlineFilterButton
            active={visitScope === 'all'}
            label="全体"
            count={allSchedules.length}
            onClick={() => onVisitScopeChange('all')}
          />
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="訪問進行状態">
        {VISIT_STATUS_FILTER_OPTIONS.map((option) => (
          <InlineFilterButton
            key={option.key}
            active={visitStatusFilter === option.key}
            label={option.label}
            count={countSchedulesByStatus(scopedSchedules, option.key)}
            onClick={() => onVisitStatusFilterChange(option.key)}
          />
        ))}
      </div>
      {scheduleReasonFilter !== 'all' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">理由フィルタ中</span>
          <button
            type="button"
            onClick={() => onScheduleReasonFilterChange('all')}
            className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary"
          >
            解除
          </button>
        </div>
      ) : null}
      {schedules.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={visitScope === 'mine' ? '自分担当の該当訪問はありません' : '該当する訪問予定はありません'}
          description="進行状態に合う訪問があると、ここに時間順で表示されます。"
          className="border-0 px-0 py-8"
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {schedules.slice(0, 6).map((schedule) => {
            const preparationProgress = countCompletedPreparationItems(schedule.preparation);
            const needsPreparation = scheduleNeedsPreparation(schedule);
            const primaryAction = resolveSchedulePrimaryAction(schedule);
            const secondaryAction = resolveScheduleSecondaryAction(schedule);
            const priorityReasons = resolveSchedulePriorityReasons(schedule);

            return (
              <li key={schedule.id} className="space-y-3 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {schedule.case_.patient.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {timeLabel(schedule.time_window_start, schedule.time_window_end)}
                      {' / '}
                      {VISIT_TYPE_LABELS[schedule.visit_type]}
                      {schedule.route_order != null ? ` / 順路 ${schedule.route_order}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {schedule.facility_hint?.label ?? schedule.site?.name ?? '個別訪問'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-1 text-[11px] font-medium',
                        statusBadgeClass(schedule.schedule_status),
                      )}
                    >
                      {SCHEDULE_STATUS_LABELS[schedule.schedule_status]}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-1 text-[11px] font-medium',
                        priorityBadgeClass(schedule.priority),
                      )}
                    >
                      {PRIORITY_LABELS[schedule.priority]}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-1',
                      needsPreparation
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {needsPreparation ? `準備 ${preparationProgress}/5` : '準備完了'}
                  </span>
                  {scheduleHasTimingGap(schedule) ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
                      時間再確認
                    </span>
                  ) : null}
                </div>

                {priorityReasons.length > 0 ? (
                  <ReasonFilterRow>
                    {priorityReasons.map((reason) => (
                      <ReasonFilterChip
                        key={`${schedule.id}-${reason.label}`}
                        reason={reason}
                        count={countSchedulesByReason(statusScopedSchedules, reason.key as HomeScheduleReasonKey)}
                        active={scheduleReasonFilter === reason.key}
                        onClick={() =>
                          onScheduleReasonFilterChange(
                            scheduleReasonFilter === reason.key
                              ? 'all'
                              : (reason.key as HomeScheduleReasonKey),
                          )
                        }
                      />
                    ))}
                  </ReasonFilterRow>
                ) : null}

                <div className="flex flex-wrap gap-3 text-xs font-medium">
                  <Link
                    href={primaryAction.href}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {primaryAction.label}
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                  <Link
                    href={secondaryAction.href}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    {secondaryAction.label}
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionShell>
  );
}

export function HomeCoordinationSection({
  focusRole,
  allCoordinationProposals,
  proposalScopedItems,
  coordinationProposals,
  proposalFilter,
  proposalReasonFilter,
  onProposalFilterChange,
  onProposalReasonFilterChange,
}: {
  focusRole: DashboardFocusRole;
  allCoordinationProposals: Proposal[];
  proposalScopedItems: Proposal[];
  coordinationProposals: Proposal[];
  proposalFilter: HomeProposalFilter;
  proposalReasonFilter: HomeProposalReasonKey | 'all';
  onProposalFilterChange: (filter: HomeProposalFilter) => void;
  onProposalReasonFilterChange: (filter: HomeProposalReasonKey | 'all') => void;
}) {
  return (
    <SectionShell
      title={focusRole === 'clerk' ? '日程調整・連絡待ち' : '調整・連絡待ち'}
      description={
        focusRole === 'clerk'
          ? '患者連絡、変更希望、再調整案件を先に見て、提案一覧へつなぎます。'
          : '当日から 3 日以内の提案のうち、患者連絡や再調整が必要なものです。'
      }
      className={focusRole === 'clerk' ? 'ring-2 ring-primary/25' : undefined}
    >
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="提案フォロー分類">
        {PROPOSAL_FILTER_OPTIONS.map((option) => (
          <InlineFilterButton
            key={option.key}
            active={proposalFilter === option.key}
            label={option.label}
            count={countCoordinationProposalsByFilter(allCoordinationProposals, option.key)}
            onClick={() => onProposalFilterChange(option.key)}
          />
        ))}
      </div>
      {proposalReasonFilter !== 'all' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">理由フィルタ中</span>
          <button
            type="button"
            onClick={() => onProposalReasonFilterChange('all')}
            className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary"
          >
            解除
          </button>
        </div>
      ) : null}
      {coordinationProposals.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="該当する提案はありません"
          description="患者連絡や再調整が必要な提案が発生すると、ここに表示されます。"
          className="border-0 px-0 py-8"
        />
      ) : (
        <ul className="space-y-3" role="list">
          {coordinationProposals.slice(0, 4).map((proposal) => {
            const proposalAction = resolveProposalPrimaryAction(proposal);
            const priorityReasons = resolveProposalPriorityReasons(proposal);

            return (
              <li key={proposal.id} className="rounded-lg border border-border/70 bg-muted/15 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {proposal.case_.patient.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(parseISO(proposal.proposed_date), 'M/d')}
                      {' / '}
                      {timeLabel(proposal.time_window_start, proposal.time_window_end)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-1 text-[11px] font-medium',
                        statusBadgeClass(proposal.proposal_status),
                      )}
                    >
                      {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-1 text-[11px] font-medium',
                        statusBadgeClass('patient_contact_pending'),
                      )}
                    >
                      {CONTACT_STATUS_LABELS[proposal.patient_contact_status]}
                    </span>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {proposal.proposal_reason}
                </p>
                {priorityReasons.length > 0 ? (
                  <div className="mt-3">
                    <ReasonFilterRow>
                      {priorityReasons.map((reason) => (
                        <ReasonFilterChip
                          key={`${proposal.id}-${reason.label}`}
                          reason={reason}
                          count={countProposalsByReason(proposalScopedItems, reason.key as HomeProposalReasonKey)}
                          active={proposalReasonFilter === reason.key}
                          onClick={() =>
                            onProposalReasonFilterChange(
                              proposalReasonFilter === reason.key
                                ? 'all'
                                : (reason.key as HomeProposalReasonKey),
                            )
                          }
                        />
                      ))}
                    </ReasonFilterRow>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
                  <Link
                    href={proposalAction.href}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {proposalAction.label}
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                  <Link
                    href={buildProposalBoardHref(proposal)}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    提案一覧で確認
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionShell>
  );
}

export function HomeScheduleShortcutSection({
  proposalFilter,
}: {
  proposalFilter: HomeProposalFilter;
}) {
  return (
    <SectionShell
      title="詳細画面"
      description="フルのスケジュール編集や提案一覧は専用画面で開きます。"
    >
      <div className="flex flex-col gap-2">
        <Link
          href="/schedules"
          className="inline-flex min-h-[44px] items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/20"
        >
          <span className="inline-flex items-center gap-2">
            <Route className="size-4 text-muted-foreground" aria-hidden="true" />
            スケジュールボードを開く
          </span>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
        <Link
          href={
            proposalFilter === 'pending'
              ? '/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact'
              : proposalFilter === 'reschedule'
                ? '/schedules/proposals?workspace=dashboard&status=proposed&preset=reschedule'
                : '/schedules/proposals?workspace=dashboard'
          }
          className="inline-flex min-h-[44px] items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/20"
        >
          <span className="inline-flex items-center gap-2">
            <PhoneCall className="size-4 text-muted-foreground" aria-hidden="true" />
            提案一覧を開く
          </span>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </SectionShell>
  );
}
