'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Car, Lock, Plus, Route, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import { SCHEDULE_STATUS_ROLE } from '@/lib/constants/status-labels';
import type { StatusRole } from '@/lib/constants/status-tokens';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { buildWorkRequestHref } from '@/lib/tasks/work-request-navigation';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { familyNameOf } from '@/lib/utils/person-name';
import { cn } from '@/lib/utils';
import type { ScheduleStatus } from '@/lib/validations/visit-schedule';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type {
  DayBoardPendingProposal,
  DayBoardStaff,
  DayBoardVisit,
  ScheduleDayBoardOperationalTask,
  ScheduleDayBoardResponse,
} from '@/types/schedule-day-board';
import { PRIORITY_DISPLAY_LABELS } from '@/lib/constants/status-labels';
import { TASK_TYPE_LABELS, formatTaskDueLabel, taskPriorityClass } from './day-view.shared';
import {
  BOARD_END_MINUTES,
  BOARD_START_MINUTES,
  boardPercent,
  buildScheduleRiskAlert,
  buildStaffLane,
  formatScheduleTimeIso,
  formatTimeOfDayIso,
  pendingProposalDateLabel,
  staffRowLabel,
  type BoardBlock,
  type StaffLane,
} from './schedule-team-board.helpers';
import { applyVisitScheduleRouteUpdates } from './visit-route-client';

/**
 * new_03_schedule(docs/design-gap-analysis-new.md 03_schedule)の全員スケジュールボード。
 * 見出し帯(日/週トグル) → 今日のスケジュール — 全員(薬剤師/事務の横型ガント+余白)
 * → リスク警告 → 未確定、右レールに 次にやること/止まっている理由/根拠・記録。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

async function fetchScheduleDayBoard(
  orgId: string,
  date: string,
): Promise<ScheduleDayBoardResponse> {
  const res = await fetch(`/api/visit-schedules/day-board?date=${date}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: ScheduleDayBoardResponse }>(
    res,
    '全員スケジュールの取得に失敗しました',
  );
  return json.data;
}

async function fetchCockpitForRail(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: DashboardCockpitResponse }>(
    res,
    '当日の優先タスク取得に失敗しました',
  );
  return json.data;
}

type ScheduleTaskStatusUpdate = Extract<ScheduleDayBoardOperationalTask['status'], 'in_progress'>;

async function updateScheduleOperationalTaskStatus({
  orgId,
  taskId,
  status,
}: {
  orgId: string;
  taskId: string;
  status: ScheduleTaskStatusUpdate;
}) {
  const res = await fetch(`/api/tasks/${encodePathSegment(taskId)}`, {
    method: 'PATCH',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? detail?.message ?? '運用タスクの更新に失敗しました');
  }
}

async function updateVisitScheduleStatus({
  orgId,
  scheduleId,
  status,
}: StatusChangePayload & { orgId: string }) {
  await patchVisitSchedule({ orgId, scheduleId, payload: { schedule_status: status } });
}

async function patchVisitSchedule({
  orgId,
  scheduleId,
  payload,
}: {
  orgId: string;
  scheduleId: string;
  payload: Record<string, unknown>;
}) {
  const res = await fetch(`/api/visit-schedules/${encodePathSegment(scheduleId)}`, {
    method: 'PATCH',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? detail?.message ?? '訪問予定の更新に失敗しました');
  }
}

/** 経過分 → 「30分」「2時間」「1日」(止まっている理由の経過時間)。 */
const formatAgeLabel = formatElapsedLabel;

function familyName(name: string): string {
  return familyNameOf(name) || name;
}

function pendingProposalCounts(board: ScheduleDayBoardResponse) {
  const visibleCount = board.pending_proposals.length;
  const counts = (board as Partial<ScheduleDayBoardResponse>).pending_proposal_counts;
  if (!counts) {
    return {
      totalCount: visibleCount,
      visibleCount,
      hiddenCount: 0,
      hiddenOperationalTaskCount: 0,
    };
  }

  return {
    totalCount: Math.max(0, counts.total_count),
    visibleCount: Math.max(0, counts.visible_count),
    hiddenCount: Math.max(0, counts.hidden_count),
    hiddenOperationalTaskCount: Math.max(0, counts.hidden_operational_task_count),
  };
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
              'inline-flex min-h-[44px] min-w-12 items-center justify-center rounded px-3 text-sm font-semibold transition-colors',
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
  visit: 'bg-tag-info text-white',
  desk: 'bg-primary text-primary-foreground',
  prep: 'bg-state-confirm text-white',
  travel:
    'bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_4px,#cbd5e1_4px,#cbd5e1_8px)] text-transparent',
  break: 'border border-dashed border-border bg-muted/40 text-muted-foreground',
  idle: 'border border-dashed border-state-done/50 bg-state-done/10 text-state-done',
};

const SCHEDULE_STATUS_OPTIONS: Array<{ value: ScheduleStatus; label: string }> = [
  { value: 'planned', label: '予定' },
  { value: 'in_preparation', label: '準備中' },
  { value: 'ready', label: '準備完了' },
  { value: 'departed', label: '出発済み' },
  { value: 'in_progress', label: '訪問中' },
  { value: 'completed', label: '完了' },
  { value: 'postponed', label: '延期' },
  { value: 'rescheduled', label: '再調整' },
  { value: 'no_show', label: '不在' },
  { value: 'cancelled', label: '中止' },
];
const INLINE_SCHEDULE_STATUS_OPTIONS = SCHEDULE_STATUS_OPTIONS.filter(
  (option) =>
    !(
      ['completed', 'postponed', 'rescheduled', 'no_show', 'cancelled'] as ScheduleStatus[]
    ).includes(option.value),
);

// 訪問ステータスのガント塗り(写像: 線形フロー→info(青) / completed→done(緑) /
// postponed・rescheduled→confirm(橙) / no_show・cancelled→blocked(赤))。
// state/tag トークンはフル彩度なので白文字の塗りに使える。
const SCHEDULE_STATUS_CLASSES: Record<ScheduleStatus, string> = {
  planned: 'bg-tag-info text-white',
  in_preparation: 'bg-tag-info text-white',
  ready: 'bg-tag-info text-white',
  departed: 'bg-tag-info text-white',
  in_progress: 'bg-tag-info text-white',
  completed: 'bg-state-done text-white',
  postponed: 'bg-state-confirm text-white',
  rescheduled: 'bg-state-confirm text-white',
  no_show: 'bg-state-blocked text-white',
  cancelled: 'bg-state-blocked text-white',
};
const UNKNOWN_PREPARATION_SUMMARY: DayBoardVisit['preparation_summary'] = {
  completed_count: 0,
  total_count: 5,
  status: 'unknown',
  incomplete_labels: ['準備未確認'],
};
const PREPARATION_DETAIL_VISIBLE_LIMIT = 2;

function scheduleStatusLabel(status: string | null): string {
  return (
    SCHEDULE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'ステータス未設定'
  );
}

/** 訪問ステータス → 6軸セマンティックロール(全 ScheduleStatus は非 neutral。未知値は info にフォールバック)。 */
function resolveScheduleStatusRole(status: string | null): StatusRole {
  const role = status ? SCHEDULE_STATUS_ROLE[status] : undefined;
  return role && role !== 'neutral' ? role : 'info';
}

function blockClassName(block: BoardBlock): string {
  if (block.kind === 'visit') {
    const statusClass =
      block.status && block.status in SCHEDULE_STATUS_CLASSES
        ? SCHEDULE_STATUS_CLASSES[block.status as ScheduleStatus]
        : BLOCK_KIND_CLASSES.visit;
    return cn(statusClass, block.risk && 'ring-2 ring-state-confirm');
  }
  return BLOCK_KIND_CLASSES[block.kind];
}

function GanttBlock({ block }: { block: BoardBlock }) {
  const left = boardPercent(block.startMinutes);
  const width = Math.max(boardPercent(block.endMinutes) - left, 1.5);
  const isAggregateVisit = block.kind === 'visit' && Boolean(block.aggregateScheduleIds);
  const scheduleId =
    block.kind === 'visit' && !isAggregateVisit ? block.id.replace(/^visit:/, '') : null;
  const requestHref = scheduleId
    ? buildWorkRequestHref({
        type: 'staff_work_request_visit',
        title: `${block.label.replace(/様$/, '')}さんの訪問に行ってほしい`,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: scheduleId,
        context: 'schedule_visit_card',
      })
    : null;
  const preparationSummary = block.preparationSummary
    ? normalizePreparationSummary(block.preparationSummary)
    : null;
  const preparationLabel = preparationSummary
    ? preparationSummaryAriaLabel(preparationSummary)
    : null;
  return (
    <li
      data-kind={block.kind}
      title={block.label}
      aria-label={preparationLabel ? `${block.label}、${preparationLabel}` : block.label}
      className={cn(
        'absolute inset-y-1.5 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1.5 text-[11px] font-medium',
        blockClassName(block),
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      {block.locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
      {block.kind === 'visit' ? (
        <span className="shrink-0 rounded bg-white/20 px-1 py-0.5 text-[10px] leading-none">
          {isAggregateVisit ? '施設一括' : scheduleStatusLabel(block.status)}
        </span>
      ) : null}
      {preparationSummary ? <PreparationSummaryChip summary={preparationSummary} compact /> : null}
      <span className={cn('truncate', block.kind === 'travel' && 'sr-only')}>{block.label}</span>
      {block.risk ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : null}
      {requestHref ? (
        <Link
          href={requestHref}
          aria-label={`${block.label}の訪問を依頼`}
          className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          data-testid="visit-work-request-link"
        >
          <Send className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
      {block.locked ? <span className="sr-only">(確定・変更は理由必須)</span> : null}
    </li>
  );
}

type VisitStatusBlock = BoardBlock & {
  kind: 'visit';
  status: string;
};

type StatusChangePayload = {
  scheduleId: string;
  status: ScheduleStatus;
};

type ApplyRecommendedVehiclePayload = {
  vehicleId: string;
  scheduleIds: string[];
};

function visitBlocksForLane(lane: StaffLane): VisitStatusBlock[] {
  return lane.blocks.filter(
    (block): block is VisitStatusBlock =>
      block.kind === 'visit' && !block.aggregateScheduleIds && Boolean(block.status),
  );
}

function ScheduleStatusControlPanel({
  lanes,
  onStatusChange,
  pendingScheduleId,
}: {
  lanes: StaffLane[];
  onStatusChange: (payload: StatusChangePayload) => void;
  pendingScheduleId: string | null;
}) {
  const laneVisits = lanes
    .map((lane) => ({ lane, visits: visitBlocksForLane(lane) }))
    .filter((item) => item.visits.length > 0);

  if (laneVisits.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3"
      data-testid="schedule-status-controls"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-sm font-bold text-foreground">ステータス変更</h4>
        <p className="text-xs text-muted-foreground">
          電話・準備・訪問後の状態を、今日の担当者別一覧から更新します。
        </p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {laneVisits.map(({ lane, visits }) => (
          <div key={lane.staffId} className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground">{lane.rowLabel}</p>
            <ul className="space-y-2" role="list">
              {visits.map((block) => {
                const scheduleId = block.id.replace(/^visit:/, '');
                const status = block.status as ScheduleStatus;
                const pending = pendingScheduleId === scheduleId;
                return (
                  <li
                    key={block.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(128px,150px)] items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {block.label}
                      </p>
                      <StateBadge
                        role={resolveScheduleStatusRole(status)}
                        className="mt-1 text-[11px] font-bold"
                      >
                        {scheduleStatusLabel(status)}
                      </StateBadge>
                    </div>
                    <select
                      aria-label={`${block.label}のステータスを変更`}
                      className="min-h-[44px] rounded-md border border-input bg-background px-2 text-sm font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={status}
                      disabled={pending}
                      onChange={(event) =>
                        onStatusChange({
                          scheduleId,
                          status: event.target.value as ScheduleStatus,
                        })
                      }
                    >
                      {INLINE_SCHEDULE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
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
        className="relative h-14 rounded-md border border-border/60 bg-muted/20"
      >
        {lane.blocks.map((block) => (
          <GanttBlock key={block.id} block={block} />
        ))}
      </ol>
      <p
        className={cn(
          'flex items-center justify-end gap-0.5 text-xs font-bold tabular-nums',
          lane.idleTone === 'tight' ? 'text-state-confirm' : 'text-state-done',
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

function TeamBoardCapacitySummary({
  lanes,
  hiddenStaffCount,
}: {
  lanes: StaffLane[];
  hiddenStaffCount: number;
}) {
  const pharmacistLanes = lanes.filter((lane) => lane.roleKind === 'pharmacist');
  if (pharmacistLanes.length === 0) return null;

  const summary = pharmacistLanes.reduce(
    (totals, lane) => ({
      visitMinutes: totals.visitMinutes + lane.visitMinutes,
      travelMinutes: totals.travelMinutes + lane.travelMinutes,
      idleMinutes: totals.idleMinutes + lane.idleMinutes,
      estimatedVisitSlots: totals.estimatedVisitSlots + lane.estimatedVisitSlots,
    }),
    { visitMinutes: 0, travelMinutes: 0, idleMinutes: 0, estimatedVisitSlots: 0 },
  );
  const items = [
    { label: '訪問', value: `${summary.visitMinutes}分` },
    { label: '移動', value: `${summary.travelMinutes}分` },
    { label: '概算余白', value: `${summary.idleMinutes}分` },
    { label: '仮枠(概算)', value: `約${summary.estimatedVisitSlots}枠` },
  ];

  return (
    <div
      className="mt-3 grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-[1.1fr_repeat(4,minmax(0,1fr))]"
      data-testid="team-board-capacity-summary"
    >
      <p className="font-semibold text-muted-foreground">
        薬剤師稼働目安
        {hiddenStaffCount > 0 ? (
          <span className="mt-0.5 block font-normal text-state-confirm">
            非表示スタッフ{hiddenStaffCount}名は別集計
          </span>
        ) : null}
      </p>
      {items.map((item) => (
        <p key={item.label} className="flex items-center justify-between gap-2 sm:block">
          <span className="text-muted-foreground">{item.label}</span>
          <strong className="tabular-nums text-foreground sm:mt-0.5 sm:block">{item.value}</strong>
        </p>
      ))}
    </div>
  );
}

const TRAVEL_MODE_LABELS: Record<string, string> = {
  DRIVE: '車',
  TWO_WHEELER: '二輪',
  BICYCLE: '自転車',
  WALK: '徒歩',
};

function vehicleRouteDurationClassName(
  status: ScheduleDayBoardResponse['vehicle_resources'][number]['route_duration_status'],
) {
  switch (status) {
    case 'exceeded':
      return 'text-state-blocked';
    case 'unverified':
      return 'text-state-confirm';
    case 'within_limit':
      return 'text-state-done';
    case 'not_limited':
      return 'text-muted-foreground';
  }
}

const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);

function routeVisitSort(left: DayBoardVisit, right: DayBoardVisit) {
  return (
    (left.route_order ?? Number.MAX_SAFE_INTEGER) -
      (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
    (left.time_start ?? '').localeCompare(right.time_start ?? '') ||
    left.patient_name.localeCompare(right.patient_name, 'ja') ||
    left.id.localeCompare(right.id)
  );
}

function routeStopLabel(visit: DayBoardVisit, index: number) {
  return visit.route_order ? `${visit.route_order}` : `仮${index + 1}`;
}

function unassignedTimedVisitsForRecommendedVehicle(board: ScheduleDayBoardResponse) {
  const recommendedVehicle = board.vehicle_resources.find((vehicle) => vehicle.recommended);
  if (!recommendedVehicle) return [];
  return board.staff
    .flatMap((member) => member.visits)
    .filter(
      (visit) =>
        visit.time_start &&
        !visit.vehicle_resource_id &&
        visit.site_id === recommendedVehicle.site_id &&
        VEHICLE_ASSIGNABLE_STATUSES.has(visit.schedule_status),
    )
    .sort(routeVisitSort)
    .slice(0, recommendedVehicle.remaining_stops);
}

// 状態色は左アクセント枠＋数値色に限定し、タイル全面の塗りつぶしは避ける
// (docs/ui-ux-design-guidelines.md「状態色の塗り面積を最小化する」)
const SUMMARY_TONE_CLASSES = {
  info: {
    item: 'border-border/70 border-l-4 border-l-tag-info bg-card',
    value: 'text-tag-info',
  },
  confirm: {
    item: 'border-border/70 border-l-4 border-l-state-confirm bg-card',
    value: 'text-state-confirm',
  },
  done: {
    item: 'border-border/70 border-l-4 border-l-state-done bg-card',
    value: 'text-state-done',
  },
  readonly: {
    item: 'border-border/70 border-l-4 border-l-border bg-card',
    value: 'text-muted-foreground',
  },
} as const;

const scheduleTopActionClassName = cn(
  buttonVariants({ variant: 'outline', size: 'sm' }),
  '!h-auto !min-h-[44px] sm:!h-auto sm:!min-h-[44px]',
);

function ScheduleDaySummaryStrip({
  board,
  dateLabel,
}: {
  board: ScheduleDayBoardResponse;
  dateLabel: string;
}) {
  const staffCounts = board.staff_counts;
  const recommendedVehicleTargets = unassignedTimedVisitsForRecommendedVehicle(board).length;
  const proposalCounts = pendingProposalCounts(board);
  const summaryItems = [
    {
      label: '訪問枠',
      value: `${staffCounts.total_visit_count}件`,
      detail:
        staffCounts.hidden_visit_count > 0 || staffCounts.hidden_count > 0
          ? `表示${staffCounts.visible_visit_count}件 +他${staffCounts.hidden_visit_count}件 / 表示${staffCounts.visible_count}名 +他${staffCounts.hidden_count}名`
          : `${staffCounts.visible_count}名で対応`,
      tone: 'info' as const,
    },
    {
      label: '出発前要確認',
      value: `${staffCounts.total_preparation_attention_count}件`,
      detail:
        staffCounts.hidden_preparation_attention_count > 0
          ? `表示${staffCounts.visible_preparation_attention_count}件 +他${staffCounts.hidden_preparation_attention_count}件`
          : staffCounts.total_preparation_attention_count > 0
            ? '準備/前提条件'
            : '準備完了',
      tone:
        staffCounts.total_preparation_attention_count > 0
          ? ('confirm' as const)
          : ('done' as const),
    },
    {
      label: '監査/記録',
      value: `${board.audit_pending_count}/${board.report_pending_count}`,
      detail: '未完了件数',
      tone:
        board.audit_pending_count > 0 || board.report_pending_count > 0
          ? ('confirm' as const)
          : ('done' as const),
    },
    {
      label: '未確定',
      value: `${proposalCounts.totalCount}件`,
      detail:
        proposalCounts.hiddenCount > 0
          ? `先頭${proposalCounts.visibleCount}件 +他${proposalCounts.hiddenCount}件`
          : proposalCounts.totalCount > 0
            ? '受入/仮枠'
            : '未確定なし',
      tone: proposalCounts.totalCount > 0 ? ('confirm' as const) : ('done' as const),
    },
    {
      label: '車両反映',
      value: `${recommendedVehicleTargets}件`,
      detail: recommendedVehicleTargets > 0 ? '推奨あり' : '割当待ちなし',
      tone: recommendedVehicleTargets > 0 ? ('info' as const) : ('readonly' as const),
    },
  ];

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-3"
      aria-labelledby="schedule-day-summary-heading"
      data-testid="schedule-day-summary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="schedule-day-summary-heading" className="text-base font-bold text-foreground">
          今日の要点
        </h3>
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {dateLabel}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {summaryItems.map((item) => {
          const toneClass = SUMMARY_TONE_CLASSES[item.tone];
          return (
            <div key={item.label} className={cn('rounded-md border px-3 py-2', toneClass.item)}>
              <dt className="text-xs font-semibold text-muted-foreground">{item.label}</dt>
              <dd className={cn('mt-1 text-xl font-bold tabular-nums', toneClass.value)}>
                {item.value}
              </dd>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </div>
          );
        })}
      </dl>
      {staffCounts.hidden_count > 0 || staffCounts.hidden_operational_task_count > 0 ? (
        <p
          className="mt-3 rounded-md border border-state-confirm/25 bg-state-confirm/5 px-3 py-2 text-sm text-state-confirm"
          data-testid="schedule-hidden-staff-counts"
        >
          非表示スタッフ{staffCounts.hidden_count}名、非表示訪問{staffCounts.hidden_visit_count}
          件。運用タスク{staffCounts.hidden_operational_task_count}
          件は詳細を展開せず件数のみ表示しています。
        </p>
      ) : null}
    </section>
  );
}

function VehicleRoutePanel({
  board,
  onApplyRecommendedVehicle,
  applyingRecommendedVehicle,
}: {
  board: ScheduleDayBoardResponse;
  onApplyRecommendedVehicle: (payload: ApplyRecommendedVehiclePayload) => void;
  applyingRecommendedVehicle: boolean;
}) {
  const [vehicleConfirmOpen, setVehicleConfirmOpen] = useState(false);
  const routeStaff = board.staff
    .map((member) => ({
      member,
      visits: [...member.visits].filter((visit) => visit.time_start).sort(routeVisitSort),
    }))
    .filter((item) => item.visits.length > 0);
  const recommendedVehicle = board.vehicle_resources.find((vehicle) => vehicle.recommended);
  const availableVehicleCount = board.vehicle_resources.filter(
    (vehicle) => vehicle.available && vehicle.remaining_stops > 0,
  ).length;
  const recommendedVehicleTargets = unassignedTimedVisitsForRecommendedVehicle(board);
  const vehicleConfirmTitle = recommendedVehicle
    ? `${recommendedVehicle.label}を未割当訪問へ反映しますか`
    : '推奨車両を反映しますか';
  const vehicleConfirmDescription = recommendedVehicle
    ? `${recommendedVehicle.label}を${recommendedVehicleTargets.length}件の訪問予定へ割り当てます。対象と出発前条件を確認してください。`
    : '推奨車両がありません。';

  const confirmRecommendedVehicle = () => {
    if (!recommendedVehicle || recommendedVehicleTargets.length === 0) return;
    onApplyRecommendedVehicle({
      vehicleId: recommendedVehicle.id,
      scheduleIds: recommendedVehicleTargets.map((visit) => visit.id),
    });
  };

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.4fr)]">
      <section
        className="rounded-md border border-border/70 bg-muted/20 p-3"
        aria-labelledby="vehicle-resource-heading"
        data-testid="schedule-vehicle-resources"
      >
        <div className="flex items-center gap-2">
          <Car className="size-4 text-primary" aria-hidden="true" />
          <h4 id="vehicle-resource-heading" className="text-sm font-bold text-foreground">
            車両リソース
          </h4>
          <span className="ml-auto text-xs font-semibold text-state-done">
            空き {availableVehicleCount}台
          </span>
        </div>
        {board.vehicle_resources.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            車両が登録されていません。車両マスターで社用車を追加してください。
          </p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {board.vehicle_resources.slice(0, 4).map((vehicle) => (
              <li
                key={vehicle.id}
                className={cn(
                  'rounded-md border px-2.5 py-2',
                  vehicle.recommended
                    ? 'border-state-done/40 bg-state-done/10'
                    : 'border-border/60 bg-card',
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                    {vehicle.label}
                  </p>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] font-bold',
                      vehicle.available && vehicle.remaining_stops > 0
                        ? 'bg-state-done/10 text-state-done'
                        : 'bg-state-confirm/10 text-state-confirm',
                    )}
                  >
                    {vehicle.recommended ? '推奨' : vehicle.available ? '空きあり' : '停止中'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {TRAVEL_MODE_LABELS[vehicle.travel_mode] ?? vehicle.travel_mode} / 使用{' '}
                  {vehicle.assigned_visit_count}件 / 残り {vehicle.remaining_stops}件
                  <span className="ml-1 font-semibold text-foreground">
                    {vehicle.recommendation_reason}
                  </span>
                </p>
                <p
                  className={cn(
                    'mt-0.5 text-xs font-semibold leading-5',
                    vehicleRouteDurationClassName(vehicle.route_duration_status),
                  )}
                >
                  {vehicle.route_duration_label}
                </p>
              </li>
            ))}
          </ul>
        )}
        {recommendedVehicle ? (
          <div className="mt-3 rounded-md border-l-4 border-border/70 border-l-tag-info bg-card p-2.5">
            <p className="text-xs leading-5 text-tag-info">
              自動提案: {recommendedVehicle.label} を未割当訪問
              {recommendedVehicleTargets.length}件へ反映できます。
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2 !h-auto !min-h-[44px] w-full sm:!h-auto sm:!min-h-[44px]"
              disabled={applyingRecommendedVehicle || recommendedVehicleTargets.length === 0}
              onClick={() => setVehicleConfirmOpen(true)}
              data-testid="apply-recommended-vehicle"
            >
              {applyingRecommendedVehicle ? '反映中' : '推奨車両を反映'}
            </Button>
            <ConfirmDialog
              open={vehicleConfirmOpen}
              onOpenChange={setVehicleConfirmOpen}
              title={vehicleConfirmTitle}
              description={vehicleConfirmDescription}
              confirmLabel={
                applyingRecommendedVehicle
                  ? '反映中'
                  : `${recommendedVehicleTargets.length}件へ車両を反映`
              }
              confirmDisabled={applyingRecommendedVehicle || recommendedVehicleTargets.length === 0}
              onConfirm={confirmRecommendedVehicle}
            >
              <div className="space-y-2 text-sm">
                <p className="text-xs font-medium text-muted-foreground">反映対象の訪問予定</p>
                <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2">
                  {recommendedVehicleTargets.map((visit) => {
                    const preparationSummary = normalizePreparationSummary(
                      visit.preparation_summary,
                    );
                    const preparationDetails = [
                      preparationSummaryDisplayLabel(preparationSummary),
                      readyBlockerDisplayLabel(preparationSummary),
                      formatPreparationDetailLabels('未完', preparationSummary.incomplete_labels),
                    ].filter((part): part is string => Boolean(part));
                    return (
                      <li
                        key={visit.id}
                        className="rounded-md bg-muted/30 px-3 py-2"
                        aria-label={`${visit.patient_name}様、${preparationSummaryAriaLabel(
                          preparationSummary,
                        )}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{visit.patient_name}様</p>
                          <p className="text-xs font-semibold text-foreground">
                            順路 {visit.route_order ?? '-'}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {visit.time_start ? formatScheduleTimeIso(visit.time_start) : '時間未定'}
                        </p>
                        <p className="mt-1 text-xs text-state-confirm">
                          {preparationDetails.join(' / ')}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs leading-5 text-muted-foreground">
                  住所、電話番号、薬剤名、処方の細部はこの確認画面には表示しません。対象訪問と出発前条件が一致している場合のみ反映してください。
                </p>
              </div>
            </ConfirmDialog>
          </div>
        ) : null}
      </section>

      <section
        className="rounded-md border border-border/70 bg-muted/20 p-3"
        aria-labelledby="route-preview-heading"
        data-testid="schedule-route-preview"
      >
        <div className="flex items-center gap-2">
          <Route className="size-4 text-primary" aria-hidden="true" />
          <h4 id="route-preview-heading" className="text-sm font-bold text-foreground">
            訪問ルート
          </h4>
          <Link
            href="/schedules/route-compare"
            className="ml-auto inline-flex min-h-[44px] items-center rounded-md px-2 text-xs font-bold text-primary underline-offset-4 hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ルート案を開く
          </Link>
        </div>
        {routeStaff.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            時間帯が入った訪問がありません。訪問枠が決まると順番を表示します。
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {routeStaff.map(({ member, visits }) => (
              <RouteStaffList key={member.id} member={member} visits={visits} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RouteStaffList({ member, visits }: { member: DayBoardStaff; visits: DayBoardVisit[] }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground">{staffRowLabel(member)}</p>
      <ol className="mt-2 space-y-1.5">
        {visits.map((visit, index) => (
          <li
            key={visit.id}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {routeStopLabel(visit, index)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {visit.patient_name}様
              </p>
              <p className="text-xs text-muted-foreground">
                {visit.time_start ? formatScheduleTimeIso(visit.time_start) : '時間未定'} /{' '}
                {visit.vehicle_label ?? '車両未割当'}
              </p>
              <PreparationSummaryChip
                summary={normalizePreparationSummary(visit.preparation_summary)}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function normalizePreparationSummary(
  summary: DayBoardVisit['preparation_summary'] | null | undefined,
): DayBoardVisit['preparation_summary'] {
  return summary ?? UNKNOWN_PREPARATION_SUMMARY;
}

function preparationSummaryAriaLabel(summary: DayBoardVisit['preparation_summary']) {
  const label = preparationSummaryDisplayLabel(summary);
  const readyBlockerLabel = readyBlockerDisplayLabel(summary);
  const readyBlockerDetailLabel = formatPreparationDetailLabels(
    '確認',
    summary.ready_blocker_summary?.category_labels ?? [],
    Number.POSITIVE_INFINITY,
  );
  const incompleteDetailLabel = formatPreparationDetailLabels(
    '未完',
    summary.incomplete_labels,
    Number.POSITIVE_INFINITY,
  );
  return [label, readyBlockerLabel, readyBlockerDetailLabel, incompleteDetailLabel]
    .filter((part): part is string => Boolean(part))
    .join('、');
}

function preparationSummaryDisplayLabel(summary: DayBoardVisit['preparation_summary']) {
  const aggregateVisitCount = summary.aggregate_visit_count ?? 0;
  const readyBlockerSummary = summary.ready_blocker_summary;
  if (aggregateVisitCount > 1 && readyBlockerSummary?.blocked) {
    const incompleteVisitCount = summary.incomplete_visit_count ?? aggregateVisitCount;
    return `出発未達 ${incompleteVisitCount}/${aggregateVisitCount}`;
  }
  if (aggregateVisitCount > 1 && summary.status !== 'ready') {
    const incompleteVisitCount = summary.incomplete_visit_count ?? aggregateVisitCount;
    return summary.status === 'unknown'
      ? `準備未確認 ${incompleteVisitCount}/${aggregateVisitCount}`
      : `準備未完 ${incompleteVisitCount}/${aggregateVisitCount}`;
  }
  if (summary.status === 'ready') return '準備チェック完了';
  if (summary.status === 'unknown') return '準備未確認';
  return `準備 ${summary.completed_count}/${summary.total_count}`;
}

function readyBlockerDisplayLabel(summary: DayBoardVisit['preparation_summary']) {
  const readyBlockerSummary = summary.ready_blocker_summary;
  if (!readyBlockerSummary?.blocked) return null;
  return `出発前条件 未解決${readyBlockerSummary.blocker_count}件`;
}

function formatPreparationDetailLabels(
  prefix: string,
  labels: readonly string[] | null | undefined,
  visibleLimit = PREPARATION_DETAIL_VISIBLE_LIMIT,
) {
  const uniqueLabels = Array.from(
    new Set((labels ?? []).map((label) => label.trim()).filter(Boolean)),
  );
  if (uniqueLabels.length === 0) return null;
  const visibleLabels = uniqueLabels.slice(0, visibleLimit);
  const hiddenCount = uniqueLabels.length - visibleLabels.length;
  return `${prefix}: ${visibleLabels.join(' / ')}${hiddenCount > 0 ? ` / 他${hiddenCount}件` : ''}`;
}

function PreparationSummaryChip({
  summary,
  compact = false,
}: {
  summary: DayBoardVisit['preparation_summary'];
  compact?: boolean;
}) {
  const readyBlocked = Boolean(summary.ready_blocker_summary?.blocked);
  const ready =
    summary.status === 'ready' && !readyBlocked && summary.incomplete_labels.length === 0;
  const readyBlockerLabel = readyBlockerDisplayLabel(summary);
  const label =
    compact && readyBlockerLabel ? readyBlockerLabel : preparationSummaryDisplayLabel(summary);
  const detailLabels = [
    readyBlockerLabel
      ? formatPreparationDetailLabels('出発前条件', summary.ready_blocker_summary?.category_labels)
      : null,
    formatPreparationDetailLabels('未完', summary.incomplete_labels),
  ].filter((part): part is string => part !== null);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 font-semibold leading-4',
        compact ? 'h-5 shrink-0 text-[10px]' : 'mt-1 text-[11px]',
        ready
          ? 'border-state-done/30 bg-state-done/10 text-state-done'
          : 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
      )}
      aria-label={preparationSummaryAriaLabel(summary)}
    >
      {!ready ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
      {detailLabels.length > 0 && !compact ? (
        <span className="truncate text-state-confirm">{detailLabels.join(' / ')}</span>
      ) : null}
    </span>
  );
}

function TeamGanttCard({
  board,
  cockpit,
  dateLabel,
  now,
  onStatusChange,
  pendingStatusScheduleId,
  onApplyRecommendedVehicle,
  applyingRecommendedVehicle,
}: {
  board: ScheduleDayBoardResponse;
  cockpit: DashboardCockpitResponse | null;
  dateLabel: string;
  now: Date;
  onStatusChange: (payload: StatusChangePayload) => void;
  pendingStatusScheduleId: string | null;
  onApplyRecommendedVehicle: (payload: ApplyRecommendedVehiclePayload) => void;
  applyingRecommendedVehicle: boolean;
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
  const nowLabel = formatTimeOfDayIso(now);
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
      </div>
      <TeamBoardCapacitySummary lanes={lanes} hiddenStaffCount={board.staff_counts.hidden_count} />

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
              {hourLabels.map((label, index) => (
                // モバイルは中央列が狭く全時刻だと潰れるため、奇数時刻はレイアウト幅を保ったまま隠す
                <span key={label} className={index % 2 === 1 ? 'max-sm:invisible' : undefined}>
                  {label}
                </span>
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
                className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-tag-info"
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
            <span>訪問色＝ステータス</span>
            <span>斜線＝移動時間</span>
            <span>緑点線＝余白</span>
            {showNowMarker ? (
              <span className="font-semibold text-tag-info">|＝いま {nowLabel}</span>
            ) : null}
          </p>
          <ScheduleStatusControlPanel
            lanes={lanes}
            onStatusChange={onStatusChange}
            pendingScheduleId={pendingStatusScheduleId}
          />
          <VehicleRoutePanel
            board={board}
            onApplyRecommendedVehicle={onApplyRecommendedVehicle}
            applyingRecommendedVehicle={applyingRecommendedVehicle}
          />
        </div>
      )}

      {riskAlert ? (
        <div
          className="mt-4 rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2.5"
          role="alert"
          data-testid="schedule-risk-banner"
        >
          <p className="flex items-start gap-2 text-sm leading-6 text-state-confirm">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-state-confirm" aria-hidden="true" />
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
              className: 'mt-2 !h-auto !min-h-[44px] bg-card sm:!h-auto sm:!min-h-[44px]',
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
  const timeLabel = proposal.time_start ? formatScheduleTimeIso(proposal.time_start) : '時間未定';
  const pharmacistLabel = proposal.pharmacist_name
    ? `仮枠(${familyName(proposal.pharmacist_name)})`
    : '仮枠';
  const isChangeRequested = proposal.patient_contact_status === 'change_requested';
  const showImpact =
    proposal.idle_before_minutes != null &&
    proposal.idle_after_minutes != null &&
    proposal.pharmacist_name != null;
  const proposalDetailHref = isChangeRequested
    ? `/schedules/proposals?workspace=dashboard&status=reschedule_pending&preset=reschedule&detail=${encodeURIComponent(proposal.id)}`
    : `/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact&detail=${encodeURIComponent(proposal.id)}`;

  return (
    <li
      className="rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2.5"
      data-testid="pending-proposal-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded bg-state-confirm/10 px-2 py-0.5 text-xs font-bold text-state-confirm">
          {proposal.badge_label}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
          {proposal.badge_label === '受入判断' ? '新規 ' : ''}
          {proposal.patient_name}様 — {dateLabel} {timeLabel} {pharmacistLabel}
        </p>
        {proposal.response_due_at ? (
          <span className="shrink-0 text-sm font-bold text-state-confirm">
            返答期限 {formatTimeOfDayIso(proposal.response_due_at)}
          </span>
        ) : null}
        <Link
          href={proposalDetailHref}
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: '!h-auto !min-h-[44px] shrink-0 bg-card sm:!h-auto sm:!min-h-[44px]',
          })}
        >
          {isChangeRequested ? '→ 再提案へ' : '→ 確定フローへ'}
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
  counts,
}: {
  proposals: DayBoardPendingProposal[];
  todayKey: string;
  counts: ReturnType<typeof pendingProposalCounts>;
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
        <span className="text-xs text-muted-foreground">{counts.totalCount}件</span>
        {counts.hiddenCount > 0 ? (
          <span className="rounded-full bg-state-confirm/10 px-2 py-0.5 text-xs font-bold text-state-confirm">
            +{counts.hiddenCount}件
          </span>
        ) : null}
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
      {counts.hiddenCount > 0 ? (
        <div className="mt-3 rounded-md border border-state-confirm/25 bg-state-confirm/5 px-3 py-2 text-sm text-state-confirm">
          先頭{counts.visibleCount}件を表示中。他{counts.hiddenCount}
          件は候補一覧で確認してください。
          {counts.hiddenOperationalTaskCount > 0
            ? ` 未表示候補に運用タスク${counts.hiddenOperationalTaskCount}件があります。`
            : ''}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 運用タスク(訪問準備 / 架電 / 変更承認)
// ---------------------------------------------------------------------------

type ScheduleOperationalTaskUpdatePayload = {
  taskId: string;
  status: ScheduleTaskStatusUpdate;
};

function visibleScheduleOperationalTasks(
  tasks: ScheduleDayBoardOperationalTask[],
  board: ScheduleDayBoardResponse,
): ScheduleDayBoardOperationalTask[] {
  const visitIds = new Set(board.staff.flatMap((member) => member.visits).map((visit) => visit.id));
  const proposalIds = new Set(board.pending_proposals.map((proposal) => proposal.id));

  return tasks.filter((task) => {
    if (task.status !== 'pending' && task.status !== 'in_progress') return false;
    if (task.related_entity_type === 'visit_schedule' && task.related_entity_id) {
      return visitIds.has(task.related_entity_id);
    }
    if (task.related_entity_type === 'visit_schedule_proposal' && task.related_entity_id) {
      return proposalIds.has(task.related_entity_id);
    }
    return false;
  });
}

function findTaskVisit(task: ScheduleDayBoardOperationalTask, board: ScheduleDayBoardResponse) {
  if (task.related_entity_type !== 'visit_schedule' || !task.related_entity_id) return null;
  return (
    board.staff
      .flatMap((member) => member.visits)
      .find((visit) => visit.id === task.related_entity_id) ?? null
  );
}

function findTaskProposal(task: ScheduleDayBoardOperationalTask, board: ScheduleDayBoardResponse) {
  if (task.related_entity_type !== 'visit_schedule_proposal' || !task.related_entity_id) {
    return null;
  }
  return board.pending_proposals.find((proposal) => proposal.id === task.related_entity_id) ?? null;
}

function operationalTaskContext(
  task: ScheduleDayBoardOperationalTask,
  board: ScheduleDayBoardResponse,
  todayKey: string,
) {
  const visit = findTaskVisit(task, board);
  if (visit) {
    const timeLabel = visit.time_start ? formatScheduleTimeIso(visit.time_start) : '時間未定';
    return `${visit.patient_name}様 — ${timeLabel} / ${visit.vehicle_label ?? '車両未割当'}`;
  }
  const proposal = findTaskProposal(task, board);
  if (proposal) {
    const dateLabel = pendingProposalDateLabel(proposal.proposed_date, todayKey);
    const timeLabel = proposal.time_start ? formatScheduleTimeIso(proposal.time_start) : '時間未定';
    return `${proposal.patient_name}様 — ${dateLabel} ${timeLabel}`;
  }
  return '対象は現在の表示日外です';
}

function operationalTaskActionHref(task: ScheduleDayBoardOperationalTask) {
  if (task.task_type === 'visit_preparation' || task.task_type === 'visit_carry_item_review') {
    if (task.related_entity_type === 'visit_schedule' && task.related_entity_id) {
      return buildScheduleFocusHref(task.related_entity_id);
    }
    return '/visits';
  }
  if (task.task_type === 'visit_schedule_override_approval') {
    return '/schedules/proposals?workspace=dashboard&status=reschedule_pending';
  }
  if (task.task_type === 'visit_contact_followup' && task.related_entity_id) {
    return `/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact&detail=${encodeURIComponent(task.related_entity_id)}`;
  }
  if (task.task_type === 'visit_schedule_reproposal_needed' && task.related_entity_id) {
    return `/schedules/proposals?workspace=dashboard&status=reschedule_pending&preset=reschedule&detail=${encodeURIComponent(task.related_entity_id)}`;
  }
  return '/tasks';
}

function operationalTaskActionLabel(task: ScheduleDayBoardOperationalTask) {
  if (task.task_type === 'visit_preparation' || task.task_type === 'visit_carry_item_review') {
    return '準備一覧へ';
  }
  if (task.task_type === 'visit_schedule_override_approval') return '変更承認へ';
  if (task.task_type === 'visit_contact_followup') return '連絡結果を記録';
  if (task.task_type === 'visit_schedule_reproposal_needed') return '再提案へ';
  return 'タスクへ';
}

function ScheduleOperationalTasksCard({
  board,
  tasks,
  todayKey,
  pendingTaskId,
  onUpdateTaskStatus,
}: {
  board: ScheduleDayBoardResponse;
  tasks: ScheduleDayBoardOperationalTask[];
  todayKey: string;
  pendingTaskId: string | null;
  onUpdateTaskStatus: (payload: ScheduleOperationalTaskUpdatePayload) => void;
}) {
  const visibleTasks = visibleScheduleOperationalTasks(tasks, board);
  if (visibleTasks.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="schedule-operational-tasks-heading"
      data-testid="schedule-operational-tasks"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id="schedule-operational-tasks-heading" className="text-base font-bold text-foreground">
          運用タスク
        </h3>
        <span className="text-xs text-muted-foreground">スケジュールに影響する未完了タスク</span>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2" role="list">
        {visibleTasks.slice(0, 6).map((task) => {
          const pending = pendingTaskId === task.id;
          const contextLabel = operationalTaskContext(task, board, todayKey);
          return (
            <li
              key={task.id}
              className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-background px-1.5 py-0.5 text-xs font-bold text-muted-foreground">
                  {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-bold',
                    taskPriorityClass(task.priority),
                  )}
                >
                  {PRIORITY_DISPLAY_LABELS[task.priority] ?? task.priority}
                </span>
                <span className="ml-auto text-xs font-semibold text-muted-foreground">
                  期限 {formatTaskDueLabel(task)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
                {task.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{contextLabel}</p>
              {task.description ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {task.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={operationalTaskActionHref(task)}
                  aria-label={`${contextLabel}の${operationalTaskActionLabel(task)}を開く`}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: '!h-auto !min-h-[44px] bg-card sm:!h-auto sm:!min-h-[44px]',
                  })}
                >
                  {operationalTaskActionLabel(task)}
                </Link>
                {task.status === 'pending' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="!h-auto !min-h-[44px] bg-card sm:!h-auto sm:!min-h-[44px]"
                    disabled={pending}
                    onClick={() => onUpdateTaskStatus({ taskId: task.id, status: 'in_progress' })}
                    aria-label={`${contextLabel}を対応中にする`}
                  >
                    対応中
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
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
        ? `${formatScheduleTimeIso(riskVisit.time_start)}訪問(${topAudit.patient_name}様)の持参薬です。完了で午後の予定がすべて確定します。`
        : `${topAudit.patient_name}様の${auditLabel}が待ちです。完了で今後の予定が確定します。`,
      actionHref: '/audit',
    };
  }
  return {
    actionLabel: '訪問準備を確認する',
    description: 'いま期限で止まっている監査はありません。今日の訪問一覧を確認します。',
    actionHref: '/visits',
  };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="スケジュール読み込み中">
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
  const queryClient = useQueryClient();
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
  const statusMutation = useMutation({
    mutationFn: (payload: StatusChangePayload) => updateVisitScheduleStatus({ orgId, ...payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule-day-board', orgId, dateKey] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-rail-cockpit', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
      ]);
    },
    onError: (error) => {
      // Make visit schedule status update failures visible with their reason.
      toast.error(error instanceof Error ? error.message : '訪問予定の更新に失敗しました');
    },
  });
  const taskStatusMutation = useMutation({
    mutationFn: (payload: ScheduleOperationalTaskUpdatePayload) =>
      updateScheduleOperationalTaskStatus({ orgId, ...payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId, dateKey] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-day-board', orgId, dateKey] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-rail-cockpit', orgId] }),
      ]);
    },
    onError: (error) => {
      // Make operational task status failures visible to avoid false completion signals.
      toast.error(error instanceof Error ? error.message : '運用タスクの更新に失敗しました');
    },
  });
  const applyRecommendedVehicleMutation = useMutation({
    mutationFn: async (payload: ApplyRecommendedVehiclePayload) => {
      await applyVisitScheduleRouteUpdates({
        orgId,
        updates: [],
        vehicleAssignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: payload.vehicleId,
          schedule_ids: payload.scheduleIds,
        },
        confirmationContext: {
          source: 'schedule_day_route_preview',
          date: dateKey,
          vehicle_assignment_count: payload.scheduleIds.length,
        },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule-day-board', orgId, dateKey] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
      ]);
    },
    onError: (error) => {
      // Make vehicle assignment failures visible to avoid phantom route assignments.
      toast.error(error instanceof Error ? error.message : '車両の割り当てに失敗しました');
    },
  });

  const board = boardQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;
  const operationalTasks = board?.operational_tasks ?? [];
  const proposalCounts = board ? pendingProposalCounts(board) : null;

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
      href: '/schedules/route-compare',
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
            {dateLabel} — 訪問枠・未確定・車両を同じ日付で確認
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/schedules/proposals?workspace=optimizer"
            className={scheduleTopActionClassName}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            予定を作る
          </Link>
          <ScheduleViewModeToggle activeView={activeView} date={dateKey} />
        </div>
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
            <div className="space-y-4">
              <div className="min-w-0 space-y-4">
                <ScheduleDaySummaryStrip board={board} dateLabel={dateLabel} />
                <TeamGanttCard
                  board={board}
                  cockpit={cockpit}
                  dateLabel={dateLabel}
                  now={now}
                  onStatusChange={(payload) => statusMutation.mutate(payload)}
                  pendingStatusScheduleId={
                    statusMutation.isPending ? (statusMutation.variables?.scheduleId ?? null) : null
                  }
                  onApplyRecommendedVehicle={(payload) =>
                    applyRecommendedVehicleMutation.mutate(payload)
                  }
                  applyingRecommendedVehicle={applyRecommendedVehicleMutation.isPending}
                />
                <ScheduleOperationalTasksCard
                  board={board}
                  tasks={operationalTasks}
                  todayKey={todayKey}
                  pendingTaskId={
                    taskStatusMutation.isPending
                      ? (taskStatusMutation.variables?.taskId ?? null)
                      : null
                  }
                  onUpdateTaskStatus={(payload) => taskStatusMutation.mutate(payload)}
                />
                <PendingProposalsCard
                  proposals={board.pending_proposals}
                  todayKey={todayKey}
                  counts={proposalCounts ?? pendingProposalCounts(board)}
                />
              </div>
              <WorkspaceActionRail
                nextAction={buildNextAction(cockpit, board)}
                blockedReasons={blockedReasons}
                blockedReasonsEmptyLabel="止まっている作業はありません"
                evidence={evidence}
                evidenceOpenLabel="開く"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
