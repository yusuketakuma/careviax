'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { VisitSchedule } from '../day-view.shared';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import { applyVisitScheduleRouteUpdates } from '../visit-route-client';
import {
  buildRecommendedRouteDetail,
  buildRouteScenarios,
  buildScenarioChartPoints,
  buildScenarioRouteOrderUpdates,
  describeScenarioOrder,
  type RouteCompareVisitInput,
  type RouteDetail,
  type RouteDetailVisitMeta,
  type RouteOrderTarget,
  type RouteScenario,
  type RouteScenarioId,
  type RouteScenarioStop,
  type RouteScenarioTone,
} from './route-scenarios';

/**
 * p1_12「ルート案を比べる」: 本日の個人宅訪問から並べ替え方針の異なる 3 案
 * (案A 移動少なめ / 案B 希望時間優先 / 案C 緊急余力優先)を合成して横並びで比較し、
 * 採用した案を既存の route_order 更新 API へ反映する。
 * 移動分は外部地図 API を使わない定数近似(route-scenarios.ts 参照)。
 */

const SCENARIO_TONE_COLORS: Record<RouteScenarioTone, string> = {
  blue: '#2563eb', // blue-600
  emerald: '#059669', // emerald-600
  amber: '#f59e0b', // amber-500
};

const CHART_WIDTH = 340;
const CHART_HEIGHT = 272;

/** @db.Time 由来の ISO 文字列を 0 時からの分へ(表示系 timeLabel と同じくローカル時刻で解釈) */
function isoTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getHours() * 60 + parsed.getMinutes();
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
    <div className="rounded-lg bg-blue-50/80 p-2">
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
const DETAIL_CHART_COLOR = '#2563eb'; // blue-600(推奨案の主役色)

/** 詳細ビューの「地図と候補」: 推奨案の訪問順を折れ線+番号ノードで示す模式チャート */
function RecommendedRouteChart({ stops }: { stops: RouteScenarioStop[] }) {
  const coords = buildScenarioChartPoints(stops.length).map((point) => ({
    x: point.x * DETAIL_CHART_WIDTH,
    y: point.y * DETAIL_CHART_HEIGHT,
  }));

  return (
    <div className="rounded-lg bg-blue-50/80 p-3">
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
          {isApplied ? (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">適用済み</Badge>
          ) : null}
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
                    ? 'flex h-4 w-4 shrink-0 items-center justify-center text-emerald-600'
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
          className="w-full sm:h-10"
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
  // 比較対象日(既定は本日)。撮影・確認用に ?date=YYYY-MM-DD で差し替え可能
  const [targetDate] = useState(() => initialDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [confirmScenario, setConfirmScenario] = useState<RouteScenario | null>(null);
  const [appliedScenarioId, setAppliedScenarioId] = useState<RouteScenarioId | null>(null);

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

  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);

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
  const scenarios = useMemo(() => buildRouteScenarios(compareVisits), [compareVisits]);

  // p0_21 詳細ビュー: 推奨案 1 本を主役にした「守る条件」判定用の付帯情報を本日の予定から集計する
  const detailMeta = useMemo<RouteDetailVisitMeta>(() => {
    const vehicleLabel =
      schedules.map((schedule) => schedule.vehicle_resource?.label ?? null).find(Boolean) ?? null;
    return {
      hasConfirmedVisit: schedules.some((schedule) => schedule.confirmed_at != null),
      hasFacilityVisit: schedules.some((schedule) => schedule.facility_batch_id != null),
      vehicleLabel,
    };
  }, [schedules]);
  const routeDetail = useMemo(
    () => buildRecommendedRouteDetail(compareVisits, detailMeta),
    [compareVisits, detailMeta],
  );
  const recommendedScenario = useMemo(
    () =>
      routeDetail
        ? (scenarios.find((scenario) => scenario.id === routeDetail.recommendedScenarioId) ?? null)
        : null,
    [routeDetail, scenarios],
  );

  const applyMutation = useMutation({
    mutationFn: async (scenario: RouteScenario) =>
      applyVisitScheduleRouteUpdates({
        orgId,
        updates: buildScenarioRouteOrderUpdates({ scenario, allVisits }),
      }),
    onSuccess: async (_result, scenario) => {
      setAppliedScenarioId(scenario.id);
      toast.success(`${scenario.shortLabel}を本日のルートに適用しました`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['visit-route-plan', orgId] }),
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
          description="本日の訪問予定の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void schedulesQuery.refetch() }}
        />
      </div>
    );
  }

  if (compareVisits.length === 0) {
    return (
      <div
        className="rounded-xl border border-border/70 bg-card p-6"
        data-testid="route-scenario-compare"
      >
        <h1 className="text-base font-bold text-foreground">ルート案を比べる</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          本日({targetDate})の個人宅訪問の予定がないため、比較できるルート案がありません。
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href="/schedules" className="font-medium text-primary hover:underline">
            スケジュールへ戻る →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">ルート最適化</h1>

      {routeDetail ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold text-foreground">ルート最適化詳細</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              本日({targetDate})の推奨ルート 1 本と、守る条件の充足状況です。
            </p>
          </div>
          <RecommendedRouteDetail
            detail={routeDetail}
            isApplied={recommendedScenario != null && appliedScenarioId === recommendedScenario.id}
            isApplying={recommendedScenario != null && pendingScenarioId === recommendedScenario.id}
            disabled={applyMutation.isPending || recommendedScenario == null}
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
        </div>
        <div className="grid gap-4 lg:grid-cols-3 xl:gap-5" data-testid="route-scenario-compare">
          {scenarios.map((scenario) => {
            const isApplied = appliedScenarioId === scenario.id;
            const isApplying = pendingScenarioId === scenario.id;
            return (
              <section
                key={scenario.id}
                className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[820px]"
                aria-label={scenario.label}
                data-testid="route-scenario-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-bold text-foreground">{scenario.label}</h2>
                  {isApplied ? (
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      適用済み
                    </Badge>
                  ) : null}
                </div>

                <ScenarioRouteChart scenario={scenario} />

                <p className="text-[15px] font-bold text-foreground">{scenario.summary}</p>

                <div>
                  <Button
                    type="button"
                    size="lg"
                    variant={scenario.recommended ? 'default' : 'outline'}
                    className={scenario.recommended ? 'w-44 sm:h-10' : 'w-44 text-primary sm:h-10'}
                    disabled={applyMutation.isPending}
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
        title={`${confirmScenario?.label ?? ''}を本日のルートに適用しますか`}
        description={
          confirmScenario
            ? `${confirmScenario.description} 訪問順 ${describeScenarioOrder(confirmScenario.stops)} で route_order を更新します。施設一括訪問は各担当の末尾に現在の居室順のまま続きます。`
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
