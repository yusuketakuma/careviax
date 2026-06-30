'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';
import type { VisitRoutePlan } from '@/types/visit-route';
import {
  priorityBadgeClass,
  PRIORITY_LABELS,
  timeLabel,
  type VisitSchedule,
} from '../day-view.shared';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import {
  applyVisitScheduleRouteUpdates,
  type VisitScheduleRouteUpdate,
} from '../visit-route-client';
import { ScheduleDateNavigator } from '../schedule-date-navigator';

/**
 * p0_20「緊急処方の割込・ルート再計算」:
 * 本日の確定済み訪問(confirmed_at)を固定したまま、緊急処方の訪問を割り込ませる。
 * - 案1: 確定患者は移動なし(全確定訪問を locked_schedule_ids で固定)
 * - 案2: 末尾の確定訪問 1 件だけ再確認を許可(その 1 件を固定から外して移動余地を作る)
 * 2 案は visit-routes API の再計算結果(totalDurationSeconds)で移動増を比較する。
 * 採用案は既存の route_order 更新 API に反映する(緊急訪問を先頭側へ寄せた順序)。
 */

const CHART_WIDTH = 520;
const CHART_HEIGHT = 320;

/** 折れ線+番号ノードの模式チャート(地図ではなく訪問順 1→n の進行を示す) */
function RouteOrderChart({
  scheduleIds,
  emergencyScheduleId,
  lockedScheduleIds,
}: {
  scheduleIds: string[];
  emergencyScheduleId: string | null;
  lockedScheduleIds: Set<string>;
}) {
  const count = scheduleIds.length;
  const coords = useMemo(() => {
    if (count === 0) return [] as Array<{ x: number; y: number }>;
    if (count === 1) return [{ x: CHART_WIDTH / 2, y: CHART_HEIGHT / 2 }];
    // 横方向に等間隔、縦はジグザグで「ルートの起伏」を模式表現する(地図ではない)
    const marginX = CHART_WIDTH * 0.08;
    const usableX = CHART_WIDTH - marginX * 2;
    const top = CHART_HEIGHT * 0.18;
    const bottom = CHART_HEIGHT * 0.82;
    return scheduleIds.map((_, index) => ({
      x: marginX + (usableX * index) / (count - 1),
      y: index % 2 === 0 ? bottom - (index % 3) * 28 : top + (index % 3) * 28,
    }));
  }, [scheduleIds, count]);

  // 訪問順ノードは状態を意味する: 緊急=blocked(赤) / 確定固定=waiting(紫=他者確認待ち) / その他=info(青)。
  function nodeColor(scheduleId: string) {
    if (scheduleId === emergencyScheduleId) return 'var(--state-blocked)';
    if (lockedScheduleIds.has(scheduleId)) return 'var(--state-waiting)';
    return 'var(--tag-info)';
  }

  return (
    <div className="rounded-lg bg-tag-info/5 p-3">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`再計算後の訪問順(${count}件)`}
      >
        {coords.length > 1 ? (
          <polyline
            points={coords.map((coord) => `${coord.x},${coord.y}`).join(' ')}
            fill="none"
            stroke="var(--tag-info)"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coords.map((coord, index) => {
          const scheduleId = scheduleIds[index];
          return (
            <g key={scheduleId}>
              <title>{`訪問 ${index + 1}`}</title>
              <circle cx={coord.x} cy={coord.y} r={15} fill={nodeColor(scheduleId)} />
              <text
                x={coord.x}
                y={coord.y}
                dy="0.35em"
                textAnchor="middle"
                fill="#ffffff"
                fontSize={13}
                fontWeight={600}
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type ScenarioResult = {
  plan: VisitRoutePlan;
  /** 基準(緊急なし)からの移動増(分)。算出不能なら null */
  travelDeltaMinutes: number | null;
  lockedScheduleIds: Set<string>;
  releasedScheduleId: string | null;
};

type RecalcResult = {
  emergencyScheduleId: string;
  plan1: ScenarioResult;
  plan2: ScenarioResult;
};

type ScenarioId = 'plan1' | 'plan2';

type ImpactTone = 'ok' | 'warn' | 'blocked' | 'unknown';

type ImpactItem = {
  id: string;
  label: string;
  detail: string;
  tone: ImpactTone;
};

type EmergencyRouteApplyPlan = {
  updates: VisitScheduleRouteUpdate[];
  routeOrderDiffCount: number;
  blockedReason: string | null;
};

const SCENARIO_LABELS: Record<ScenarioId, string> = {
  plan1: '案1',
  plan2: '案2',
};

const IMPACT_TONE_META: Record<ImpactTone, { marker: string; srLabel: string; className: string }> =
  {
    ok: { marker: '✓', srLabel: '確認済み', className: 'text-state-done' },
    warn: { marker: '!', srLabel: '要確認', className: 'text-state-confirm' },
    blocked: { marker: '×', srLabel: '反映不可', className: 'text-state-blocked' },
    unknown: { marker: '?', srLabel: '未確認', className: 'text-muted-foreground' },
  };

function scenarioLabel(scenarioId: ScenarioId) {
  return SCENARIO_LABELS[scenarioId];
}

function routeIdHeaders(orgId: string) {
  return { 'Content-Type': 'application/json', 'x-org-id': orgId } as const;
}

async function computeRoutePlan(args: {
  orgId: string;
  scheduleIds: string[];
  lockedScheduleIds?: string[];
  travelMode?: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
}): Promise<VisitRoutePlan> {
  const res = await fetch('/api/visit-routes', {
    method: 'POST',
    headers: routeIdHeaders(args.orgId),
    body: JSON.stringify({
      schedule_ids: args.scheduleIds,
      travel_mode: args.travelMode ?? 'DRIVE',
      ...(args.lockedScheduleIds && args.lockedScheduleIds.length > 0
        ? { locked_schedule_ids: args.lockedScheduleIds }
        : {}),
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message ?? 'ルート再計算の取得に失敗しました');
  }
  const payload = (await res.json()) as { data: VisitRoutePlan };
  return payload.data;
}

function deltaMinutes(scenarioSeconds: number | null, baselineSeconds: number | null) {
  if (scenarioSeconds == null || baselineSeconds == null) return null;
  return Math.max(0, Math.round((scenarioSeconds - baselineSeconds) / 60));
}

function formatDeltaLabel(minutes: number | null) {
  if (minutes == null) return '移動 増減 未計算';
  return `移動 +${minutes}分`;
}

function routeCellKey(schedule: VisitSchedule, routeOrder: number) {
  return `${schedule.pharmacist_id}:${schedule.scheduled_date}:${routeOrder}`;
}

function scheduleByRouteOrder(a: VisitSchedule, b: VisitSchedule) {
  return (a.route_order ?? Number.MAX_SAFE_INTEGER) - (b.route_order ?? Number.MAX_SAFE_INTEGER);
}

export function buildEmergencyRouteApplyPlan(args: {
  orderedScheduleIds: string[];
  scheduleById: Map<string, VisitSchedule>;
}): EmergencyRouteApplyPlan {
  const desiredSchedules = args.orderedScheduleIds
    .map((scheduleId) => args.scheduleById.get(scheduleId))
    .filter((schedule): schedule is VisitSchedule => Boolean(schedule));

  const mutableSchedules = desiredSchedules.filter((schedule) => !schedule.confirmed_at);
  if (mutableSchedules.length === 0) {
    return {
      updates: [],
      routeOrderDiffCount: 0,
      blockedReason: '反映できる未確定訪問がありません',
    };
  }

  const mutableScheduleIds = new Set(mutableSchedules.map((schedule) => schedule.id));
  const occupiedCells = new Set<string>();
  for (const schedule of args.scheduleById.values()) {
    if (schedule.route_order == null || mutableScheduleIds.has(schedule.id)) continue;
    occupiedCells.add(routeCellKey(schedule, schedule.route_order));
  }

  const assignedRouteOrders = new Map<string, number>();
  let previousFixedRouteOrder = 0;
  let segment: VisitSchedule[] = [];
  let blockedReason: string | null = null;

  const allocateSegment = (upperFixedRouteOrder: number | null) => {
    if (segment.length === 0 || blockedReason) return;
    if (
      upperFixedRouteOrder != null &&
      upperFixedRouteOrder - previousFixedRouteOrder <= segment.length
    ) {
      blockedReason = '確定済み訪問の間に未確定訪問を挿入できる順路番号の空きがありません';
      return;
    }

    let nextCandidate = previousFixedRouteOrder + 1;
    for (const schedule of segment) {
      let assigned: number | null = null;
      while (upperFixedRouteOrder == null || nextCandidate < upperFixedRouteOrder) {
        const candidateKey = routeCellKey(schedule, nextCandidate);
        nextCandidate += 1;
        if (occupiedCells.has(candidateKey)) continue;
        occupiedCells.add(candidateKey);
        assigned = nextCandidate - 1;
        break;
      }

      if (assigned == null) {
        blockedReason = '確定済み訪問の間に未確定訪問を挿入できる順路番号の空きがありません';
        return;
      }
      assignedRouteOrders.set(schedule.id, assigned);
    }
  };

  for (const schedule of desiredSchedules) {
    if (schedule.confirmed_at) {
      if (schedule.route_order == null) {
        return {
          updates: [],
          routeOrderDiffCount: 0,
          blockedReason: '確定済み訪問の現在順路が未設定のため反映できません',
        };
      }
      allocateSegment(schedule.route_order);
      if (blockedReason) break;
      previousFixedRouteOrder = schedule.route_order;
      segment = [];
      continue;
    }

    segment.push(schedule);
  }
  allocateSegment(null);

  if (blockedReason) {
    return { updates: [], routeOrderDiffCount: 0, blockedReason };
  }

  const updates = mutableSchedules
    .map((schedule) => {
      const routeOrder = assignedRouteOrders.get(schedule.id);
      if (routeOrder == null || routeOrder === schedule.route_order) return null;
      return {
        scheduleId: schedule.id,
        route_order: routeOrder,
        expected_route_order: schedule.route_order,
      };
    })
    .filter((update): update is NonNullable<typeof update> => Boolean(update));

  if (updates.length === 0) {
    return {
      updates: [],
      routeOrderDiffCount: 0,
      blockedReason: '反映が必要な順路差分はありません',
    };
  }

  return {
    updates,
    routeOrderDiffCount: updates.length,
    blockedReason: null,
  };
}

function formatReleasedScheduleSummary(schedule: VisitSchedule | null) {
  if (!schedule) return '再確認対象の訪問を特定できません';
  const routeOrderLabel =
    schedule.route_order == null ? '順路未設定' : `現在 #${schedule.route_order}`;
  const visitTimeLabel = timeLabel(schedule.time_window_start, schedule.time_window_end);
  return `${schedule.case_.patient.name} 様 / ${visitTimeLabel} / ${routeOrderLabel}`;
}

function buildVehicleImpactItem(
  scenario: ScenarioResult | null,
  scheduleById: Map<string, VisitSchedule>,
): ImpactItem {
  if (!scenario) {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: '再計算後に確認',
      tone: 'unknown',
    };
  }

  if (scenario.plan.status === 'unavailable') {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: scenario.plan.note ?? 'ルート計算不可',
      tone: 'blocked',
    };
  }

  const vehicleStats = new Map<
    string,
    {
      label: string;
      count: number;
      maxStops: number | null;
      maxRouteDurationMinutes: number | null;
    }
  >();
  let unassignedCount = 0;

  for (const scheduleId of scenario.plan.orderedScheduleIds) {
    const vehicle = scheduleById.get(scheduleId)?.vehicle_resource;
    if (!vehicle) {
      unassignedCount += 1;
      continue;
    }

    const stat = vehicleStats.get(vehicle.id) ?? {
      label: vehicle.label,
      count: 0,
      maxStops: vehicle.max_stops,
      maxRouteDurationMinutes: vehicle.max_route_duration_minutes,
    };
    stat.count += 1;
    vehicleStats.set(vehicle.id, stat);
  }

  if (vehicleStats.size === 0) {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: `車両未割当 ${scenario.plan.orderedScheduleIds.length}件`,
      tone: 'unknown',
    };
  }

  const stopLimitExceeded = [...vehicleStats.values()].find(
    (stat) => stat.maxStops != null && stat.count > stat.maxStops,
  );
  if (stopLimitExceeded) {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: `${stopLimitExceeded.label} ${stopLimitExceeded.count}/${stopLimitExceeded.maxStops}件で上限超過`,
      tone: 'blocked',
    };
  }

  const totalDurationMinutes =
    scenario.plan.totalDurationSeconds == null
      ? null
      : Math.round(scenario.plan.totalDurationSeconds / 60);
  const durationLimitExceeded =
    totalDurationMinutes == null
      ? null
      : [...vehicleStats.values()].find(
          (stat) =>
            stat.maxRouteDurationMinutes != null &&
            totalDurationMinutes > stat.maxRouteDurationMinutes,
        );
  if (durationLimitExceeded && totalDurationMinutes != null) {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: `${durationLimitExceeded.label} ${totalDurationMinutes}/${durationLimitExceeded.maxRouteDurationMinutes}分で上限超過`,
      tone: 'blocked',
    };
  }

  if (unassignedCount > 0) {
    return {
      id: 'vehicle',
      label: '車両・移動制約',
      detail: `車両未割当 ${unassignedCount}件あり`,
      tone: 'warn',
    };
  }

  const vehicleLabels = [...vehicleStats.values()]
    .map((stat) => `${stat.label} ${stat.count}件`)
    .join(' / ');
  return {
    id: 'vehicle',
    label: '車両・移動制約',
    detail:
      totalDurationMinutes == null ? vehicleLabels : `${vehicleLabels} / ${totalDurationMinutes}分`,
    tone: 'ok',
  };
}

function buildPharmacistImpactItem(
  scenario: ScenarioResult | null,
  scheduleById: Map<string, VisitSchedule>,
): ImpactItem {
  if (!scenario) {
    return {
      id: 'pharmacist',
      label: '薬剤師負荷',
      detail: '再計算後に確認',
      tone: 'unknown',
    };
  }

  if (scenario.plan.status === 'unavailable') {
    return {
      id: 'pharmacist',
      label: '薬剤師負荷',
      detail: 'ルート計算不可のため反映前確認が必要',
      tone: 'blocked',
    };
  }

  const pharmacistStats = new Map<string, { count: number; urgentCount: number }>();
  for (const scheduleId of scenario.plan.orderedScheduleIds) {
    const schedule = scheduleById.get(scheduleId);
    if (!schedule) continue;
    const stat = pharmacistStats.get(schedule.pharmacist_id) ?? { count: 0, urgentCount: 0 };
    stat.count += 1;
    if (schedule.priority === 'urgent' || schedule.priority === 'emergency') {
      stat.urgentCount += 1;
    }
    pharmacistStats.set(schedule.pharmacist_id, stat);
  }

  if (pharmacistStats.size === 0) {
    return {
      id: 'pharmacist',
      label: '薬剤師負荷',
      detail: '担当薬剤師の予定を取得できません',
      tone: 'unknown',
    };
  }

  const stats = [...pharmacistStats.values()];
  const maxVisitCount = Math.max(...stats.map((stat) => stat.count));
  const urgentCount = stats.reduce((sum, stat) => sum + stat.urgentCount, 0);
  const deltaLabel =
    scenario.travelDeltaMinutes == null ? '移動増未計算' : `移動+${scenario.travelDeltaMinutes}分`;
  const tone: ImpactTone =
    scenario.releasedScheduleId || (scenario.travelDeltaMinutes ?? 0) > 0 ? 'warn' : 'ok';

  return {
    id: 'pharmacist',
    label: '薬剤師負荷',
    detail: `${pharmacistStats.size}名 / 最大${maxVisitCount}件 / 緊急${urgentCount}件 / ${deltaLabel}`,
    tone,
  };
}

function buildImpactItems(args: {
  scenario: ScenarioResult | null;
  selectedPlanId: ScenarioId;
  confirmedCount: number;
  scheduleById: Map<string, VisitSchedule>;
  applyPlan: EmergencyRouteApplyPlan | null;
}): ImpactItem[] {
  const { scenario, selectedPlanId, confirmedCount, scheduleById, applyPlan } = args;
  const label = scenarioLabel(selectedPlanId);

  if (!scenario) {
    return [
      {
        id: 'fixed',
        label: '正式決定',
        detail: '再計算後に固定件数を確認',
        tone: 'unknown',
      },
      {
        id: 'patient-confirmation',
        label: '患者確認待ち',
        detail: '再計算後に確認',
        tone: 'unknown',
      },
      buildVehicleImpactItem(null, scheduleById),
      buildPharmacistImpactItem(null, scheduleById),
      {
        id: 'route',
        label: 'ルート計算',
        detail: '未計算',
        tone: 'unknown',
      },
      {
        id: 'apply',
        label: '反映対象',
        detail: '再計算後に確認',
        tone: 'unknown',
      },
    ];
  }

  return [
    {
      id: 'fixed',
      label: '正式決定',
      detail:
        scenario.releasedScheduleId != null
          ? `${label}: ${scenario.lockedScheduleIds.size}/${confirmedCount}件を固定`
          : `${label}: ${confirmedCount}件を固定`,
      tone: scenario.plan.status === 'ok' ? 'ok' : 'blocked',
    },
    {
      id: 'patient-confirmation',
      label: '患者確認待ち',
      detail: scenario.releasedScheduleId != null ? '1件あり' : '0件',
      tone: scenario.releasedScheduleId != null ? 'warn' : 'ok',
    },
    buildVehicleImpactItem(scenario, scheduleById),
    buildPharmacistImpactItem(scenario, scheduleById),
    {
      id: 'route',
      label: 'ルート計算',
      detail:
        scenario.plan.status === 'ok'
          ? (scenario.plan.note ?? '計算完了')
          : (scenario.plan.note ?? '計算不可'),
      tone: scenario.plan.status === 'ok' ? 'ok' : 'blocked',
    },
    {
      id: 'apply',
      label: '反映対象',
      detail: applyPlan?.blockedReason ?? `未確定訪問 ${applyPlan?.updates.length ?? 0}件`,
      tone: applyPlan?.blockedReason ? 'blocked' : 'ok',
    },
  ];
}

export function EmergencyRouteContent({ initialDate }: { initialDate?: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const syncSearchParams = useSyncedSearchParams();
  const [targetDate, setTargetDate] = useState(
    () => initialDate ?? format(new Date(), 'yyyy-MM-dd'),
  );
  const [recalc, setRecalc] = useState<RecalcResult | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<ScenarioId>('plan1');
  const [confirmApply, setConfirmApply] = useState(false);
  const handleSelectDate = (date: string) => {
    setTargetDate(date);
    setRecalc(null);
    setSelectedPlanId('plan1');
    syncSearchParams({ date });
  };
  const dateNavigator = (
    <ScheduleDateNavigator
      value={targetDate}
      onSelectDate={handleSelectDate}
      inputId="emergency-route-target-date"
      ariaLabel="緊急ルートの対象日"
    />
  );

  const schedulesQuery = useQuery({
    queryKey: ['visit-schedules', 'emergency-route', orgId, targetDate],
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

  // 個人宅訪問のみ対象(施設一括訪問は居室順管理のため除外)
  const personalVisits = useMemo(
    () => schedules.filter((schedule) => !schedule.facility_batch_id),
    [schedules],
  );

  // 緊急患者: 確定していない緊急/準緊急の訪問(なければ緊急/準緊急の先頭)
  const emergencySchedule = useMemo(() => {
    const byPriority = (priority: VisitSchedule['priority']) =>
      personalVisits.filter((schedule) => schedule.priority === priority);
    const unconfirmedEmergency = byPriority('emergency').find((s) => !s.confirmed_at);
    const unconfirmedUrgent = byPriority('urgent').find((s) => !s.confirmed_at);
    return (
      unconfirmedEmergency ??
      unconfirmedUrgent ??
      byPriority('emergency')[0] ??
      byPriority('urgent')[0] ??
      null
    );
  }, [personalVisits]);

  // 確定済み訪問(緊急患者本人は除く)= 移動させたくない患者
  const confirmedSchedules = useMemo(
    () =>
      personalVisits.filter(
        (schedule) => !!schedule.confirmed_at && schedule.id !== emergencySchedule?.id,
      ),
    [personalVisits, emergencySchedule],
  );

  // route_order 昇順に並べた本日の対象スケジュール(緊急患者を含む全件)
  const orderedScheduleIds = useMemo(
    () =>
      [...personalVisits]
        .sort(
          (a, b) =>
            (a.route_order ?? Number.MAX_SAFE_INTEGER) - (b.route_order ?? Number.MAX_SAFE_INTEGER),
        )
        .map((schedule) => schedule.id),
    [personalVisits],
  );

  const scheduleById = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules],
  );

  const recalcMutation = useMutation({
    mutationFn: async (): Promise<RecalcResult> => {
      if (!emergencySchedule) {
        throw new Error('割り込ませる緊急処方の訪問が見つかりません');
      }
      const confirmedIds = confirmedSchedules.map((schedule) => schedule.id);
      // 案2 は route_order 末尾の確定訪問 1 件を固定から外して再確認を許可する
      const confirmedByRouteOrder = [...confirmedSchedules].sort(scheduleByRouteOrder);
      const lastConfirmedId =
        confirmedByRouteOrder.length > 0
          ? confirmedByRouteOrder[confirmedByRouteOrder.length - 1].id
          : null;
      const plan2LockedIds = lastConfirmedId
        ? confirmedIds.filter((id) => id !== lastConfirmedId)
        : confirmedIds;

      // 基準: 緊急患者を除いた現行ルート(確定患者の移動を測る土台)
      const baselineScheduleIds = orderedScheduleIds.filter((id) => id !== emergencySchedule.id);

      const [baselinePlan, plan1, plan2] = await Promise.all([
        baselineScheduleIds.length > 0
          ? computeRoutePlan({ orgId, scheduleIds: baselineScheduleIds })
          : Promise.resolve<VisitRoutePlan | null>(null),
        computeRoutePlan({
          orgId,
          scheduleIds: orderedScheduleIds,
          lockedScheduleIds: confirmedIds,
        }),
        computeRoutePlan({
          orgId,
          scheduleIds: orderedScheduleIds,
          lockedScheduleIds: plan2LockedIds,
        }),
      ]);

      const baselineSeconds = baselinePlan?.totalDurationSeconds ?? null;
      return {
        emergencyScheduleId: emergencySchedule.id,
        plan1: {
          plan: plan1,
          travelDeltaMinutes: deltaMinutes(plan1.totalDurationSeconds, baselineSeconds),
          lockedScheduleIds: new Set(confirmedIds),
          releasedScheduleId: null,
        },
        plan2: {
          plan: plan2,
          travelDeltaMinutes: deltaMinutes(plan2.totalDurationSeconds, baselineSeconds),
          lockedScheduleIds: new Set(plan2LockedIds),
          releasedScheduleId: lastConfirmedId,
        },
      };
    },
    onSuccess: (result) => {
      setRecalc(result);
      setSelectedPlanId('plan1');
      toast.success('ルートを再計算しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'ルート再計算に失敗しました');
    },
  });

  // 選択中の案の訪問順を route_order に反映する
  const applyMutation = useMutation({
    mutationFn: async (planId: ScenarioId) => {
      const scenario = recalc?.[planId];
      const plan = scenario?.plan;
      if (!plan) throw new Error('反映できる案がありません');
      if (plan.status !== 'ok') throw new Error('ルート計算不可の案は反映できません');
      const applyPlan = buildEmergencyRouteApplyPlan({
        orderedScheduleIds: plan.orderedScheduleIds,
        scheduleById,
      });
      if (applyPlan.blockedReason) throw new Error(applyPlan.blockedReason);
      await applyVisitScheduleRouteUpdates({
        orgId,
        updates: applyPlan.updates,
        confirmationContext: {
          source: 'emergency_route_interruption',
          date: targetDate,
          travel_mode: plan.travelMode,
          target_count: applyPlan.updates.length,
          route_order_diff_count: applyPlan.routeOrderDiffCount,
          ...(scenario.releasedScheduleId
            ? {
                released_schedule_id: scenario.releasedScheduleId,
                patient_reconfirmation_required: true,
              }
            : { patient_reconfirmation_required: false }),
        },
      });
      return { planId };
    },
    onSuccess: async ({ planId }) => {
      toast.success(`${scenarioLabel(planId)}を対象日のルートに反映しました`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['visit-route-plan', orgId] }),
      ]);
      void schedulesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'ルートの反映に失敗しました');
    },
  });

  if (!orgId || schedulesQuery.isLoading) {
    return (
      <div
        className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_280px] xl:gap-5"
        role="status"
        aria-label="緊急ルート再計算 読み込み中"
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
          title="緊急ルートを表示できません"
          description="対象日の訪問予定の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void schedulesQuery.refetch() }}
        />
      </div>
    );
  }

  if (!emergencySchedule) {
    return (
      <div
        className="rounded-xl border border-border/70 bg-card p-6"
        data-testid="emergency-route-empty"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">緊急処方の割込・ルート再計算</h1>
          {dateNavigator}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {targetDate} に割り込ませる緊急/準緊急の個人宅訪問がありません。
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href="/schedules" className="font-medium text-primary hover:underline">
            スケジュールへ戻る →
          </Link>
        </p>
      </div>
    );
  }

  const emergencyPatientName = emergencySchedule.case_.patient.name;
  const selectedScenario = recalc?.[selectedPlanId] ?? null;
  const selectedScenarioLabel = scenarioLabel(selectedPlanId);
  const selectedScenarioLockedSet = selectedScenario?.lockedScheduleIds ?? new Set<string>();
  const selectedApplyPlan = selectedScenario
    ? buildEmergencyRouteApplyPlan({
        orderedScheduleIds: selectedScenario.plan.orderedScheduleIds,
        scheduleById,
      })
    : null;
  const selectedScenarioCanApply =
    selectedScenario?.plan.status === 'ok' && !selectedApplyPlan?.blockedReason;
  const releasedScheduleSummary = formatReleasedScheduleSummary(
    selectedScenario?.releasedScheduleId
      ? (scheduleById.get(selectedScenario.releasedScheduleId) ?? null)
      : null,
  );
  const impactItems = buildImpactItems({
    scenario: selectedScenario,
    selectedPlanId,
    confirmedCount: confirmedSchedules.length,
    scheduleById,
    applyPlan: selectedApplyPlan,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-bold text-foreground">緊急処方の割込・ルート再計算</h1>
        {dateNavigator}
      </div>
      <div
        className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_280px] xl:gap-5"
        data-testid="emergency-route-recalculation"
      >
        {/* LEFT: 緊急で追加 + 再計算ボタン */}
        <section
          className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
          aria-label="緊急で追加"
          data-testid="emergency-route-patient"
        >
          <h2 className="text-[15px] font-bold text-foreground">緊急で追加</h2>
          <div>
            <p className="text-lg font-bold text-foreground">{emergencyPatientName} 様</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={priorityBadgeClass(emergencySchedule.priority)}>
                {PRIORITY_LABELS[emergencySchedule.priority]}
              </Badge>
              <span className="text-sm font-semibold text-state-blocked">当日中にお届け</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            システムが現在のルートへ入れる場所を探します。
          </p>
          <div>
            <Button
              type="button"
              size="lg"
              className="w-full sm:h-11"
              disabled={recalcMutation.isPending}
              onClick={() => recalcMutation.mutate()}
              data-testid="emergency-route-recalc-button"
            >
              {recalcMutation.isPending ? '再計算中…' : 'ルートを再計算'}
            </Button>
          </div>
        </section>

        {/* CENTER: 再計算後のルート + 案1/案2 比較 */}
        <section
          className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
          aria-label="再計算後のルート"
          data-testid="emergency-route-scenarios"
        >
          <h2 className="text-[15px] font-bold text-foreground">再計算後のルート</h2>

          {recalc ? (
            <RouteOrderChart
              scheduleIds={selectedScenario?.plan.orderedScheduleIds ?? []}
              emergencyScheduleId={recalc.emergencyScheduleId}
              lockedScheduleIds={selectedScenarioLockedSet}
            />
          ) : (
            <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-tag-info/5 p-6 text-center text-sm text-muted-foreground">
              「ルートを再計算」を押すと、確定患者を固定した 2 つの案を表示します。
            </div>
          )}
          {recalc ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-state-blocked" aria-hidden />
                緊急訪問
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-state-waiting" aria-hidden />
                固定する確定訪問
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-tag-info" aria-hidden />
                調整対象
              </span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              className={[
                'rounded-lg border p-4 text-left transition-colors',
                selectedPlanId === 'plan1'
                  ? 'border-primary bg-primary/5'
                  : 'border-border/70 bg-card hover:border-primary/50',
                !recalc ? 'cursor-not-allowed opacity-80' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!recalc}
              aria-pressed={selectedPlanId === 'plan1'}
              aria-label="案1を選択"
              onClick={() => setSelectedPlanId('plan1')}
              data-testid="emergency-route-scenario-1"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-foreground">案1</h3>
                {selectedPlanId === 'plan1' ? <Badge variant="secondary">選択中</Badge> : null}
              </div>
              <p className="mt-2 text-sm font-semibold text-state-done">正式決定患者は変更なし</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recalc ? formatDeltaLabel(recalc.plan1.travelDeltaMinutes) : '移動 —'}
              </p>
            </button>
            <button
              type="button"
              className={[
                'rounded-lg border p-4 text-left transition-colors',
                selectedPlanId === 'plan2'
                  ? 'border-primary bg-primary/5'
                  : 'border-border/70 bg-card hover:border-primary/50',
                !recalc ? 'cursor-not-allowed opacity-80' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!recalc}
              aria-pressed={selectedPlanId === 'plan2'}
              aria-label="案2を選択"
              onClick={() => setSelectedPlanId('plan2')}
              data-testid="emergency-route-scenario-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-foreground">案2</h3>
                {selectedPlanId === 'plan2' ? <Badge variant="secondary">選択中</Badge> : null}
              </div>
              <p className="mt-2 text-sm font-semibold text-state-confirm">1件だけ再確認が必要</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recalc ? formatDeltaLabel(recalc.plan2.travelDeltaMinutes) : '移動 —'}
              </p>
            </button>
          </div>
        </section>

        {/* RIGHT: 影響確認チェックリスト + 選択案で反映 */}
        <section
          className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
          aria-label="影響確認"
          data-testid="emergency-route-impact"
        >
          <h2 className="text-[15px] font-bold text-foreground">影響確認</h2>
          <ul className="space-y-3 text-sm text-foreground">
            {impactItems.map((item) => {
              const tone = IMPACT_TONE_META[item.tone];
              return (
                <li key={item.id} className="flex items-start gap-2">
                  <span
                    role="img"
                    aria-label={tone.srLabel}
                    className={['mt-0.5 font-semibold', tone.className].join(' ')}
                  >
                    {tone.marker}
                  </span>
                  <span>
                    <span className="font-medium">{item.label}：</span>
                    {item.detail}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto">
            <Button
              type="button"
              size="lg"
              className="w-full sm:h-11"
              disabled={!selectedScenarioCanApply || applyMutation.isPending}
              onClick={() => setConfirmApply(true)}
              data-testid="emergency-route-apply-button"
            >
              {applyMutation.isPending
                ? '反映中…'
                : selectedScenarioCanApply
                  ? `${selectedScenarioLabel}で反映`
                  : '反映不可'}
            </Button>
          </div>
        </section>

        <ConfirmDialog
          open={confirmApply}
          onOpenChange={(open) => {
            if (!open) setConfirmApply(false);
          }}
          title={`${selectedScenarioLabel}を対象日のルートに反映しますか`}
          description={`${selectedScenarioLabel}の順序で、確定済み訪問は更新対象から除外し、未確定訪問の route_order だけを更新します。${
            selectedScenario?.releasedScheduleId
              ? `この案では患者確認待ちが 1 件発生します: ${releasedScheduleSummary}。`
              : '患者確認待ちは発生しません。'
          }施設一括訪問は各担当の末尾に現在の居室順のまま続きます。`}
          confirmLabel={`${selectedScenarioLabel}で反映`}
          requiredConfirmText={selectedScenario?.releasedScheduleId ? '再確認済み' : undefined}
          onConfirm={() => {
            setConfirmApply(false);
            applyMutation.mutate(selectedPlanId);
          }}
        />
      </div>
    </div>
  );
}
