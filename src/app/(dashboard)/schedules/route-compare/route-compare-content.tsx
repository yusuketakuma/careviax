'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Route } from 'lucide-react';
import { toast } from 'sonner';
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';
import { timeIsoToMinutes } from '@/lib/visits/time-of-day';
import type { ScheduleDayBoardResponse } from '@/types/schedule-day-board';
import type { VisitRoutePlan, VisitRouteTravelMode } from '@/types/visit-route';
import type { VisitSchedule } from '../day-view.shared';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import { applyVisitScheduleRouteUpdates } from '../visit-route-client';
import { ScheduleDateNavigator } from '../schedule-date-navigator';
import {
  buildRecommendedRouteDetail,
  buildRouteScenarioRequests,
  buildRouteScenariosFromPlans,
  buildRouteScenarioComparisonRows,
  buildScenarioChartPoints,
  buildScenarioRouteOrderUpdates,
  describeScenarioOrder,
  type RouteCompareVisitInput,
  type RouteDetail,
  type RouteDetailVisitMeta,
  type RouteOrderTarget,
  type RouteScenario,
  type RouteScenarioPlanResult,
  type RouteScenarioId,
  type RouteScenarioStop,
  type RouteScenarioTone,
} from './route-scenarios';

/**
 * p1_12「ルート案を比べる」: 本日の個人宅訪問から並べ替え方針の異なる 3 案
 * (案A 移動少なめ / 案B 希望時間優先 / 案C 緊急余力優先)を合成して横並びで比較し、
 * 採用した案を既存の route_order 更新 API へ反映する。
 * 移動分と採用可否は既存の visit route engine API で計算する。
 */

// 3 案の折れ線は系列の識別であって状態色ではない → chart トークンを使う(状態トークンは流用しない)。
const SCENARIO_TONE_COLORS: Record<RouteScenarioTone, string> = {
  blue: 'var(--chart-1)',
  emerald: 'var(--chart-2)',
  amber: 'var(--chart-3)',
};

const CHART_WIDTH = 340;
const CHART_HEIGHT = 272;
const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);
const VISIT_ROUTE_TRAVEL_MODES = new Set<VisitRouteTravelMode>([
  'DRIVE',
  'BICYCLE',
  'WALK',
  'TWO_WHEELER',
]);
const EMPTY_ROUTE_SCENARIOS: RouteScenario[] = [];

async function fetchScheduleDayBoard(args: { orgId: string; date: string }) {
  const res = await fetch(`/api/visit-schedules/day-board?date=${args.date}`, {
    headers: { 'x-org-id': args.orgId },
  });
  if (!res.ok) throw new Error('対象日の車両リソース取得に失敗しました');
  const json = (await res.json()) as { data: ScheduleDayBoardResponse };
  return json.data;
}

function normalizeVisitRouteTravelMode(value: string | null | undefined): VisitRouteTravelMode {
  return value && VISIT_ROUTE_TRAVEL_MODES.has(value as VisitRouteTravelMode)
    ? (value as VisitRouteTravelMode)
    : 'DRIVE';
}

function routeHeaders(orgId: string) {
  return { 'Content-Type': 'application/json', 'x-org-id': orgId } as const;
}

function errorMessageFromUnknown(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function computeRoutePlan(args: {
  orgId: string;
  scheduleIds: string[];
  lockedScheduleIds: string[];
  travelMode: VisitRouteTravelMode;
  vehicleResourceId?: string;
}): Promise<VisitRoutePlan> {
  const res = await fetch('/api/visit-routes', {
    method: 'POST',
    headers: routeHeaders(args.orgId),
    body: JSON.stringify({
      schedule_ids: args.scheduleIds,
      travel_mode: args.travelMode,
      ...(args.lockedScheduleIds.length > 0 ? { locked_schedule_ids: args.lockedScheduleIds } : {}),
      ...(args.vehicleResourceId ? { vehicle_resource_id: args.vehicleResourceId } : {}),
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message ?? 'ルート計算の取得に失敗しました');
  }
  const payload = (await res.json()) as { data: VisitRoutePlan };
  return payload.data;
}

async function fetchRouteCompareScenarios(args: {
  orgId: string;
  visits: RouteCompareVisitInput[];
  travelMode: VisitRouteTravelMode;
  vehicleResourceId?: string;
}) {
  const requests = buildRouteScenarioRequests(args.visits);
  const results = await Promise.all(
    requests.map(async (request): Promise<RouteScenarioPlanResult> => {
      try {
        const plan = await computeRoutePlan({
          orgId: args.orgId,
          scheduleIds: request.scheduleIds,
          lockedScheduleIds: request.lockedScheduleIds,
          travelMode: args.travelMode,
          vehicleResourceId: args.vehicleResourceId,
        });
        return { scenarioId: request.scenarioId, plan };
      } catch (error) {
        return {
          scenarioId: request.scenarioId,
          errorMessage: errorMessageFromUnknown(error, 'ルート計算の取得に失敗しました'),
        };
      }
    }),
  );

  return buildRouteScenariosFromPlans({ visits: args.visits, results });
}

function isoTimeToMinutes(value: string | null): number | null {
  return timeIsoToMinutes(value);
}

function toCompareVisitInput(schedule: VisitSchedule): RouteCompareVisitInput {
  return {
    scheduleId: schedule.id,
    patientName: schedule.case_.patient.name,
    pharmacistId: schedule.pharmacist_id,
    startMinutes: isoTimeToMinutes(schedule.time_window_start),
    endMinutes: isoTimeToMinutes(schedule.time_window_end),
    priority: schedule.priority,
    routeOrder: schedule.route_order,
    confirmedAt: schedule.confirmed_at,
    proximityKey: schedule.case_.patient.residences[0]?.building_id ?? null,
  };
}

function toRouteOrderTarget(schedule: VisitSchedule): RouteOrderTarget {
  return {
    scheduleId: schedule.id,
    pharmacistId: schedule.pharmacist_id,
    facilityBatchId: schedule.facility_batch_id,
    routeOrder: schedule.route_order,
    startMinutes: isoTimeToMinutes(schedule.time_window_start),
    confirmedAt: schedule.confirmed_at,
  };
}

/** 折れ線+番号ノードの模式チャート(地図ではなく訪問順 1→n の進行を示す) */
function ScenarioRouteChart({ scenario }: { scenario: RouteScenario }) {
  const color = SCENARIO_TONE_COLORS[scenario.tone];
  const coords = buildScenarioChartPoints(scenario.stops.length).map((point) => ({
    x: point.x * CHART_WIDTH,
    y: point.y * CHART_HEIGHT,
  }));

  return (
    <div className="rounded-lg bg-muted/40 p-2">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${scenario.label}の訪問順: ${describeScenarioOrder(scenario.stops)}`}
      >
        {coords.length > 1 ? (
          <polyline
            points={coords.map((coord) => `${coord.x},${coord.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coords.map((coord, index) => {
          const stop = scenario.stops[index];
          return (
            <g key={stop.scheduleId}>
              <title>{`${stop.order} ${stop.patientName}`}</title>
              <circle cx={coord.x} cy={coord.y} r={12} fill={color} />
              <text
                x={coord.x}
                y={coord.y}
                dy="0.35em"
                textAnchor="middle"
                fill="#ffffff"
                fontSize={11}
                fontWeight={600}
              >
                {stop.order}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const DETAIL_CHART_WIDTH = 520;
const DETAIL_CHART_HEIGHT = 300;
const DETAIL_CHART_COLOR = 'var(--chart-1)'; // 推奨案の主役系列色(状態色ではない)

/** 詳細ビューの「地図と候補」: 推奨案の訪問順を折れ線+番号ノードで示す模式チャート */
function RecommendedRouteChart({ stops }: { stops: RouteScenarioStop[] }) {
  const coords = buildScenarioChartPoints(stops.length).map((point) => ({
    x: point.x * DETAIL_CHART_WIDTH,
    y: point.y * DETAIL_CHART_HEIGHT,
  }));

  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <svg
        viewBox={`0 0 ${DETAIL_CHART_WIDTH} ${DETAIL_CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`推奨ルートの訪問順: ${describeScenarioOrder(stops)}`}
      >
        {coords.length > 1 ? (
          <polyline
            points={coords.map((coord) => `${coord.x},${coord.y}`).join(' ')}
            fill="none"
            stroke={DETAIL_CHART_COLOR}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coords.map((coord, index) => {
          const stop = stops[index];
          return (
            <g key={stop.scheduleId}>
              <title>{`${stop.order} ${stop.patientName}`}</title>
              <circle cx={coord.x} cy={coord.y} r={14} fill={DETAIL_CHART_COLOR} />
              <text
                x={coord.x}
                y={coord.y}
                dy="0.35em"
                textAnchor="middle"
                fill="#ffffff"
                fontSize={13}
                fontWeight={600}
              >
                {stop.order}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * p0_21「ルート最適化詳細 + 守る条件」: 推奨案 1 本を主役にした詳細ビュー。
 * 訪問パケット(順番付き) / 地図と候補(候補1・候補2) / 守る条件チェックリストの 3 カラム。
 * 「このルートを使う」は 3 案比較と同じ適用フローを推奨案で実行する。
 */
function RecommendedRouteDetail({
  detail,
  isApplied,
  isApplying,
  disabled,
  onApply,
}: {
  detail: RouteDetail;
  isApplied: boolean;
  isApplying: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <section
      className="grid gap-4 lg:grid-cols-3 xl:gap-5"
      aria-label="推奨ルートの詳細"
      data-testid="route-recommended-detail"
    >
      {/* 訪問パケット(推奨案の訪問順) */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-[15px] font-bold text-foreground">訪問パケット</h2>
        <ol className="flex flex-col gap-2.5">
          {detail.stops.map((stop) => (
            <li
              key={stop.scheduleId}
              className="rounded-lg border border-border/70 bg-background px-3.5 py-3"
              data-testid="route-detail-stop"
            >
              <p className="text-sm font-bold text-foreground">
                {stop.order}. {stop.patientName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stop.timeWindowLabel ? `希望時間あり ${stop.timeWindowLabel}` : '希望時間なし'} /{' '}
                {stop.durationMinutes}分
              </p>
            </li>
          ))}
        </ol>
      </div>

      {/* 地図と候補(推奨ルートの模式図 + 候補1/候補2 サマリー) */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-[15px] font-bold text-foreground">地図と候補</h2>
        <RecommendedRouteChart stops={detail.chartStops} />
        <dl className="flex flex-col gap-1.5">
          {detail.candidates.map((candidate) => (
            <div key={candidate.scenarioId} data-testid="route-detail-candidate">
              <dt className="sr-only">{candidate.rankLabel}</dt>
              <dd
                className={
                  candidate.recommended
                    ? 'text-[15px] font-bold text-foreground'
                    : 'text-sm text-muted-foreground'
                }
              >
                {candidate.rankLabel}：{candidate.summary}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 守る条件チェックリスト + 適用ボタン */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold text-foreground">守る条件</h2>
          {isApplied ? <StateBadge role="done">適用済み</StateBadge> : null}
        </div>
        <ul className="flex flex-col gap-2.5">
          {detail.constraints.map((constraint) => (
            <li
              key={constraint.id}
              className="flex items-center gap-2 text-sm"
              data-testid="route-detail-constraint"
            >
              <span
                aria-hidden="true"
                className={
                  constraint.checked
                    ? 'flex h-4 w-4 shrink-0 items-center justify-center text-state-done'
                    : 'flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50'
                }
              >
                {constraint.checked ? '✓' : '−'}
              </span>
              <span className={constraint.checked ? 'text-foreground' : 'text-muted-foreground'}>
                {constraint.label}
              </span>
              <span className="sr-only">
                {constraint.checked ? '(条件を満たしています)' : '(対象なし)'}
              </span>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="lg"
          className="min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
          disabled={disabled}
          onClick={onApply}
          data-testid="route-detail-apply"
        >
          {isApplying ? '適用中…' : 'このルートを使う'}
        </Button>
      </div>
    </section>
  );
}

export function RouteCompareContent({ initialDate }: { initialDate?: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const syncSearchParams = useSyncedSearchParams();
  // 比較対象日(既定は本日)。撮影・確認用に ?date=YYYY-MM-DD で差し替え可能
  const [targetDate, setTargetDate] = useState(
    () => initialDate ?? format(new Date(), 'yyyy-MM-dd'),
  );
  const [confirmScenario, setConfirmScenario] = useState<RouteScenario | null>(null);
  const [appliedScenarioId, setAppliedScenarioId] = useState<RouteScenarioId | null>(null);
  const handleSelectDate = (date: string) => {
    setTargetDate(date);
    setConfirmScenario(null);
    setAppliedScenarioId(null);
    syncSearchParams({ date });
  };
  const dateNavigator = (
    <ScheduleDateNavigator
      value={targetDate}
      onSelectDate={handleSelectDate}
      inputId="route-compare-target-date"
      ariaLabel="比較する対象日"
    />
  );

  const schedulesQuery = useQuery({
    queryKey: ['visit-schedules', 'route-compare', orgId, targetDate],
    queryFn: async () =>
      fetchVisitSchedulesWindow<VisitSchedule>({
        orgId,
        dateFrom: targetDate,
        dateTo: targetDate,
        statusScope: 'active',
      }),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const dayBoardQuery = useQuery({
    queryKey: ['schedule-day-board', orgId, targetDate],
    queryFn: () => fetchScheduleDayBoard({ orgId, date: targetDate }),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const recommendedVehicle = useMemo(
    () => dayBoardQuery.data?.vehicle_resources.find((vehicle) => vehicle.recommended) ?? null,
    [dayBoardQuery.data],
  );
  const routeTravelMode = normalizeVisitRouteTravelMode(recommendedVehicle?.travel_mode);

  // 比較対象は個人宅訪問のみ。施設一括訪問は居室順(施設トラッカー)で管理するため除外する
  const compareVisits = useMemo(
    () =>
      schedules
        .filter((schedule) => !schedule.facility_batch_id)
        .map((schedule) => toCompareVisitInput(schedule)),
    [schedules],
  );
  const allVisits = useMemo(
    () => schedules.map((schedule) => toRouteOrderTarget(schedule)),
    [schedules],
  );
  const routeScenarioInputKey = useMemo(
    () =>
      compareVisits
        .map(
          (visit) =>
            `${visit.scheduleId}:${visit.routeOrder ?? 'none'}:${visit.startMinutes ?? 'none'}:${
              visit.endMinutes ?? 'none'
            }:${visit.priority}:${visit.confirmedAt ?? 'mutable'}`,
        )
        .join('|'),
    [compareVisits],
  );
  const routeScenariosQuery = useQuery({
    queryKey: [
      'visit-routes',
      'route-compare-scenarios',
      orgId,
      targetDate,
      routeScenarioInputKey,
      recommendedVehicle?.id ?? 'no-vehicle',
      routeTravelMode,
    ],
    queryFn: () =>
      fetchRouteCompareScenarios({
        orgId,
        visits: compareVisits,
        travelMode: routeTravelMode,
        ...(recommendedVehicle ? { vehicleResourceId: recommendedVehicle.id } : {}),
      }),
    enabled: !!orgId && compareVisits.length > 0 && !dayBoardQuery.isLoading,
    staleTime: 30_000,
  });
  const scenarios = routeScenariosQuery.data ?? EMPTY_ROUTE_SCENARIOS;
  const scenarioComparisonById = useMemo(
    () =>
      new Map(
        buildRouteScenarioComparisonRows(scenarios).map((comparison) => [
          comparison.scenarioId,
          comparison,
        ]),
      ),
    [scenarios],
  );

  // p0_21 詳細ビュー: 推奨案 1 本を主役にした「守る条件」判定用の付帯情報を本日の予定から集計する
  const detailMeta = useMemo<RouteDetailVisitMeta>(() => {
    const vehicleLabel =
      schedules.map((schedule) => schedule.vehicle_resource?.label ?? null).find(Boolean) ??
      recommendedVehicle?.label ??
      null;
    return {
      hasConfirmedVisit: schedules.some((schedule) => schedule.confirmed_at != null),
      hasFacilityVisit: schedules.some((schedule) => schedule.facility_batch_id != null),
      vehicleLabel,
    };
  }, [recommendedVehicle?.label, schedules]);
  const routeDetail = useMemo(
    () =>
      scenarios.length > 0
        ? buildRecommendedRouteDetail(compareVisits, scenarios, detailMeta)
        : null,
    [compareVisits, detailMeta, scenarios],
  );
  const recommendedScenario = useMemo(
    () =>
      routeDetail
        ? (scenarios.find((scenario) => scenario.id === routeDetail.recommendedScenarioId) ?? null)
        : null,
    [routeDetail, scenarios],
  );

  const applyMutation = useMutation({
    mutationFn: async (scenario: RouteScenario) => {
      if (scenario.applyDisabledReason) {
        throw new Error(scenario.applyDisabledReason);
      }
      const routeUpdates = buildScenarioRouteOrderUpdates({ scenario, allVisits });
      const routeUpdateScheduleIds = new Set(routeUpdates.map((update) => update.scheduleId));
      const vehicleAssignmentScheduleIds =
        recommendedVehicle == null
          ? []
          : schedules
              .filter(
                (schedule) =>
                  routeUpdateScheduleIds.has(schedule.id) &&
                  !schedule.vehicle_resource?.id &&
                  VEHICLE_ASSIGNABLE_STATUSES.has(schedule.schedule_status),
              )
              .sort(
                (left, right) =>
                  (left.route_order ?? Number.MAX_SAFE_INTEGER) -
                    (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
                  (isoTimeToMinutes(left.time_window_start) ?? Number.MAX_SAFE_INTEGER) -
                    (isoTimeToMinutes(right.time_window_start) ?? Number.MAX_SAFE_INTEGER) ||
                  left.case_.patient.name.localeCompare(right.case_.patient.name, 'ja') ||
                  left.id.localeCompare(right.id),
              )
              .slice(0, recommendedVehicle.remaining_stops)
              .map((schedule) => schedule.id);

      return applyVisitScheduleRouteUpdates({
        orgId,
        updates: routeUpdates,
        ...(recommendedVehicle && vehicleAssignmentScheduleIds.length > 0
          ? {
              vehicleAssignment: {
                mode: 'assign_if_unassigned' as const,
                vehicle_resource_id: recommendedVehicle.id,
                schedule_ids: vehicleAssignmentScheduleIds,
              },
            }
          : {}),
        confirmationContext: {
          source: 'route_compare_adoption',
          date: targetDate,
          target_count: routeUpdates.length,
          route_order_diff_count: routeUpdates.length,
          vehicle_assignment_count: vehicleAssignmentScheduleIds.length,
        },
      });
    },
    onSuccess: async (_result, scenario) => {
      setAppliedScenarioId(scenario.id);
      const vehicleSuffix = recommendedVehicle ? ` / ${recommendedVehicle.label}も反映` : '';
      toast.success(`${scenario.shortLabel}を対象日のルートに適用しました${vehicleSuffix}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['visit-route-plan', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['visit-routes', 'route-compare-scenarios', orgId],
        }),
        queryClient.invalidateQueries({ queryKey: ['schedule-day-board', orgId, targetDate] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問予定の順路更新に失敗しました');
    },
  });
  const pendingScenarioId = applyMutation.isPending ? applyMutation.variables?.id : undefined;

  if (!orgId || schedulesQuery.isLoading) {
    return (
      <div
        className="grid gap-4 lg:grid-cols-3 xl:gap-5"
        role="status"
        aria-label="ルート案読み込み中"
      >
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (schedulesQuery.isError) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="ルート案を表示できません"
          description="対象日の訪問予定の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void schedulesQuery.refetch() }}
        />
      </div>
    );
  }

  if (compareVisits.length === 0) {
    return (
      <div className="space-y-4" data-testid="route-scenario-compare">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">ルート案を比べる</h1>
          {dateNavigator}
        </div>
        <EmptyState
          icon={Route}
          title={`${targetDate} の個人宅訪問の予定がないため、比較できるルート案がありません。`}
          action={{ label: 'スケジュールへ戻る', href: '/schedules' }}
        />
      </div>
    );
  }

  if (dayBoardQuery.isLoading || routeScenariosQuery.isLoading) {
    return (
      <div className="space-y-4" data-testid="route-scenario-compare">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">ルート最適化</h1>
          {dateNavigator}
        </div>
        <div
          className="grid gap-4 lg:grid-cols-3 xl:gap-5"
          role="status"
          aria-label="ルート案読み込み中"
        >
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (routeScenariosQuery.isError) {
    return (
      <div className="space-y-4" data-testid="route-scenario-compare">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">ルート最適化</h1>
          {dateNavigator}
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <ErrorState
            variant="server"
            title="ルート案を計算できません"
            description="対象日の訪問予定をもとにした経路計算に失敗しました。再試行してください。"
            action={{ label: '再試行', onClick: () => void routeScenariosQuery.refetch() }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-bold text-foreground">ルート最適化</h1>
        {dateNavigator}
      </div>

      {routeDetail ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold text-foreground">ルート最適化詳細</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {targetDate} の推奨ルート 1 本と、守る条件の充足状況です。
              {recommendedVehicle
                ? ` 採用時は未割当の訪問に ${recommendedVehicle.label} を同時に反映します。`
                : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              移動時間は既存のルートエンジンで再計算しています。座標未設定や車両制約がある案は採用できません。
            </p>
          </div>
          <RecommendedRouteDetail
            detail={routeDetail}
            isApplied={recommendedScenario != null && appliedScenarioId === recommendedScenario.id}
            isApplying={recommendedScenario != null && pendingScenarioId === recommendedScenario.id}
            disabled={
              applyMutation.isPending ||
              recommendedScenario == null ||
              recommendedScenario.applyDisabledReason != null
            }
            onApply={() => {
              if (recommendedScenario) setConfirmScenario(recommendedScenario);
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-bold text-foreground">ルート案を比べる</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            並べ替え方針の異なる 3 案を比較して採用します。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            移動時間と訪問順は /api/visit-routes
            のルートエンジン結果を使います。未計算・座標未設定・車両制約超過の案は比較表示だけに留めます。
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3 xl:gap-5" data-testid="route-scenario-compare">
          {scenarios.map((scenario) => {
            const isApplied = appliedScenarioId === scenario.id;
            const isApplying = pendingScenarioId === scenario.id;
            const comparison = scenarioComparisonById.get(scenario.id);
            return (
              <section
                key={scenario.id}
                className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[820px]"
                aria-label={scenario.label}
                data-testid="route-scenario-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-bold text-foreground">{scenario.label}</h2>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {scenario.recommended ? <StateBadge role="info">推奨</StateBadge> : null}
                    {scenario.applyDisabledReason ? (
                      <StateBadge role="blocked">採用不可</StateBadge>
                    ) : (
                      <StateBadge role="done">経路計算済み</StateBadge>
                    )}
                    {isApplied ? <StateBadge role="done">適用済み</StateBadge> : null}
                  </div>
                </div>

                {comparison ? (
                  <div className="rounded-lg border border-border/70 bg-background px-3 py-2.5">
                    <p className="text-sm font-semibold text-foreground">
                      {comparison.decisionLabel} / {comparison.summaryDetail}
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-muted/50 px-2 py-1.5">
                        <p className="text-muted-foreground">移動</p>
                        <p className="font-semibold text-foreground tabular-nums">
                          {comparison.travelMinutes == null
                            ? '未計算'
                            : `${comparison.travelMinutes}分`}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted/50 px-2 py-1.5">
                        <p className="text-muted-foreground">推奨比</p>
                        <p className="font-semibold text-foreground tabular-nums">
                          {comparison.travelDeltaMinutes == null
                            ? '未計算'
                            : comparison.travelDeltaMinutes === 0
                              ? '±0分'
                              : `+${comparison.travelDeltaMinutes}分`}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted/50 px-2 py-1.5">
                        <p className="text-muted-foreground">訪問</p>
                        <p className="font-semibold text-foreground tabular-nums">
                          {comparison.stopCount}件
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <ScenarioRouteChart scenario={scenario} />

                <p className="text-[15px] font-bold text-foreground">{scenario.summary}</p>

                {scenario.note || scenario.applyDisabledReason ? (
                  <div
                    className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                    data-testid="route-scenario-note"
                  >
                    {scenario.applyDisabledReason ? (
                      <p className="font-medium text-foreground">
                        採用不可: {scenario.applyDisabledReason}
                      </p>
                    ) : null}
                    {scenario.note ? (
                      <p className="mt-1 first:mt-0">計算メモ: {scenario.note}</p>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <Button
                    type="button"
                    size="lg"
                    variant={scenario.recommended ? 'default' : 'outline'}
                    className={scenario.recommended ? 'w-44 sm:h-10' : 'w-44 text-primary sm:h-10'}
                    disabled={applyMutation.isPending || scenario.applyDisabledReason != null}
                    onClick={() => setConfirmScenario(scenario)}
                  >
                    {isApplying ? '適用中…' : 'この案を使う'}
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={confirmScenario !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmScenario(null);
        }}
        title={`${confirmScenario?.label ?? ''}を対象日のルートに適用しますか`}
        description={
          confirmScenario
            ? `${confirmScenario.description} 担当者ごとの訪問順 ${describeScenarioOrder(confirmScenario.stops)} を反映します。施設一括訪問は各担当の末尾に現在の居室順のまま続きます。${
                recommendedVehicle
                  ? ` 未割当の訪問には ${recommendedVehicle.label} も同時に反映します。`
                  : ''
              }`
            : ''
        }
        confirmLabel="この案を使う"
        onConfirm={() => {
          if (confirmScenario) applyMutation.mutate(confirmScenario);
        }}
      />
    </div>
  );
}
