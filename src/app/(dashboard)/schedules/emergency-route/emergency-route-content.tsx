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
import type { VisitRoutePlan } from '@/types/visit-route';
import { priorityBadgeClass, PRIORITY_LABELS, type VisitSchedule } from '../day-view.shared';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import { applyVisitScheduleRouteUpdates } from '../visit-route-client';

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
};

type RecalcResult = {
  emergencyScheduleId: string;
  lockedScheduleIds: Set<string>;
  releasedScheduleId: string | null;
  plan1: ScenarioResult;
  plan2: ScenarioResult;
};

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

export function EmergencyRouteContent({ initialDate }: { initialDate?: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [targetDate] = useState(() => initialDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [recalc, setRecalc] = useState<RecalcResult | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

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

  const recalcMutation = useMutation({
    mutationFn: async (): Promise<RecalcResult> => {
      if (!emergencySchedule) {
        throw new Error('割り込ませる緊急処方の訪問が見つかりません');
      }
      const confirmedIds = confirmedSchedules.map((schedule) => schedule.id);
      // 案2 は route_order 末尾の確定訪問 1 件を固定から外して再確認を許可する
      const lastConfirmedId =
        confirmedSchedules.length > 0
          ? [...confirmedSchedules].sort(
              (a, b) =>
                (a.route_order ?? Number.MAX_SAFE_INTEGER) -
                (b.route_order ?? Number.MAX_SAFE_INTEGER),
            )[confirmedSchedules.length - 1].id
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
        lockedScheduleIds: new Set(confirmedIds),
        releasedScheduleId: lastConfirmedId,
        plan1: {
          plan: plan1,
          travelDeltaMinutes: deltaMinutes(plan1.totalDurationSeconds, baselineSeconds),
        },
        plan2: {
          plan: plan2,
          travelDeltaMinutes: deltaMinutes(plan2.totalDurationSeconds, baselineSeconds),
        },
      };
    },
    onSuccess: (result) => {
      setRecalc(result);
      toast.success('ルートを再計算しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'ルート再計算に失敗しました');
    },
  });

  // 「案1で反映」: 案1(確定患者の移動なし)の訪問順を route_order に反映する
  const applyMutation = useMutation({
    mutationFn: async () => {
      const plan = recalc?.plan1.plan;
      if (!plan) throw new Error('反映できる案がありません');
      const updates = plan.orderedScheduleIds.map((scheduleId, index) => ({
        scheduleId,
        route_order: index + 1,
      }));
      return applyVisitScheduleRouteUpdates({ orgId, updates });
    },
    onSuccess: async () => {
      toast.success('案1を本日のルートに反映しました');
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
          description="本日の訪問予定の取得に失敗しました。再試行してください。"
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
        <h1 className="text-base font-bold text-foreground">緊急処方の割込・ルート再計算</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          本日({targetDate})に割り込ませる緊急/準緊急の個人宅訪問がありません。
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
  const lockedSet = recalc?.lockedScheduleIds ?? new Set<string>();

  return (
    <div
      className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_280px] xl:gap-5"
      data-testid="emergency-route-recalculation"
    >
      <h1 className="sr-only">緊急処方の割込・ルート再計算</h1>

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
            <span className="text-sm font-semibold text-state-blocked">本日中にお届け</span>
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
            scheduleIds={recalc.plan1.plan.orderedScheduleIds}
            emergencyScheduleId={recalc.emergencyScheduleId}
            lockedScheduleIds={lockedSet}
          />
        ) : (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-tag-info/5 p-6 text-center text-sm text-muted-foreground">
            「ルートを再計算」を押すと、確定患者を固定した 2 つの案を表示します。
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className="rounded-lg border border-border/70 bg-card p-4"
            data-testid="emergency-route-scenario-1"
          >
            <h3 className="text-[15px] font-bold text-foreground">案1</h3>
            <p className="mt-2 text-sm font-semibold text-state-done">正式決定患者は変更なし</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {recalc ? formatDeltaLabel(recalc.plan1.travelDeltaMinutes) : '移動 —'}
            </p>
          </div>
          <div
            className="rounded-lg border border-border/70 bg-card p-4"
            data-testid="emergency-route-scenario-2"
          >
            <h3 className="text-[15px] font-bold text-foreground">案2</h3>
            <p className="mt-2 text-sm font-semibold text-state-confirm">1件だけ再確認が必要</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {recalc ? formatDeltaLabel(recalc.plan2.travelDeltaMinutes) : '移動 —'}
            </p>
          </div>
        </div>
      </section>

      {/* RIGHT: 影響確認チェックリスト + 案1で反映 */}
      <section
        className="flex flex-col gap-5 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
        aria-label="影響確認"
        data-testid="emergency-route-impact"
      >
        <h2 className="text-[15px] font-bold text-foreground">影響確認</h2>
        <ul className="space-y-3 text-sm text-foreground">
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-state-done">
              ✓
            </span>
            <span>正式決定：変更なし</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-state-done">
              ✓
            </span>
            <span>患者確認待ち：{recalc?.releasedScheduleId ? '1件あり' : '0件'}</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-state-done">
              ✓
            </span>
            <span>社用車A：使用可</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-state-done">
              ✓
            </span>
            <span>薬剤師負荷：許容範囲</span>
          </li>
        </ul>
        <div className="mt-auto">
          <Button
            type="button"
            size="lg"
            className="w-full sm:h-11"
            disabled={!recalc || applyMutation.isPending}
            onClick={() => setConfirmApply(true)}
            data-testid="emergency-route-apply-button"
          >
            {applyMutation.isPending ? '反映中…' : '案1で反映'}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmApply}
        onOpenChange={(open) => {
          if (!open) setConfirmApply(false);
        }}
        title="案1を本日のルートに反映しますか"
        description="確定患者の訪問順を保ったまま、緊急処方の訪問を割り込ませた順序で route_order を更新します。施設一括訪問は各担当の末尾に現在の居室順のまま続きます。"
        confirmLabel="案1で反映"
        onConfirm={() => {
          setConfirmApply(false);
          applyMutation.mutate();
        }}
      />
    </div>
  );
}
