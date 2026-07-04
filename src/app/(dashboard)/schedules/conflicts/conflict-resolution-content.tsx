'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { CalendarCheck2 } from 'lucide-react';
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';
import { timeIsoToMinutes } from '@/lib/visits/time-of-day';
import { messageFromError } from '@/lib/utils/error-message';
import { ScheduleDateNavigator } from '../schedule-date-navigator';
import type { Pharmacist, VisitSchedule } from '../day-view.shared';
import { applyVisitScheduleRouteUpdates } from '../visit-route-client';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import {
  buildScheduleConflictViewModel,
  type AdjustmentPlan,
  type AdjustmentPlanTone,
  type ConflictRow,
  type ConflictScheduleInput,
} from '@/lib/schedules/visit-schedule-conflicts';

const conflictRowColumns: ColumnDef<ConflictRow>[] = [
  {
    accessorKey: 'subject',
    header: '対象',
    cell: ({ row }) => (
      <span
        data-testid="conflict-row"
        className="flex items-center gap-2 font-medium text-foreground"
      >
        {row.original.subject}
        {row.original.confirmed ? (
          <StateBadge role="done" className="text-[11px]">
            確定
          </StateBadge>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: 'timeLabel',
    header: '時間',
    cell: ({ row }) => <span className="tabular-nums">{row.original.timeLabel}</span>,
  },
  {
    accessorKey: 'detail',
    header: '内容',
  },
];

/**
 * p0_19「予定の重なりを直す」: 本日の訪問予定から、同一薬剤師の時間帯重複と
 * 同一社用車の同時使用を検知し、左に重なり一覧テーブル、中央に調整案 A/B/C、
 * 右に「次にやること」(推奨案の採用 / 患者再確認)を提示し、
 * 採用時は訪問予定の担当変更、再確認時は検証済みタスク作成まで永続化する調整画面。
 * 検知・調整案合成のロジックは lib/schedules/visit-schedule-conflicts.ts に集約する。
 */

// 調整案カードの面色は意味トークンへ。blue=推奨/情報(info 青)、amber=要確認(confirm 橙)、slate=中立。
const PLAN_CARD_TONE: Record<AdjustmentPlanTone, string> = {
  blue: 'border-tag-info/30 bg-tag-info/5',
  amber: 'border-state-confirm/30 bg-state-confirm/5',
  slate: 'border-border/70 bg-card',
};

const CONFLICT_REORDERABLE_STATUSES: ReadonlySet<VisitSchedule['schedule_status']> = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);

type ConflictPlanAdoptionDraft =
  | {
      ok: true;
      plan: AdjustmentPlan;
      targetSchedule: VisitSchedule;
      targetPharmacist: Pharmacist;
      routeOrder: number;
    }
  | {
      ok: false;
      plan: AdjustmentPlan | null;
      reason: string;
    };

function isoTimeToMinutes(value: string | null): number | null {
  return timeIsoToMinutes(value);
}

function scheduleDateKey(schedule: VisitSchedule) {
  return schedule.scheduled_date.slice(0, 10);
}

function schedulesOverlap(left: VisitSchedule, right: VisitSchedule) {
  const leftStart = isoTimeToMinutes(left.time_window_start);
  const rightStart = isoTimeToMinutes(right.time_window_start);
  if (leftStart == null || rightStart == null) return false;
  const leftEnd = isoTimeToMinutes(left.time_window_end) ?? leftStart;
  const rightEnd = isoTimeToMinutes(right.time_window_end) ?? rightStart;
  return leftStart < rightEnd && rightStart < leftEnd ? true : leftStart === rightStart;
}

function findConflictPlanAdoptionDraft(args: {
  plan: AdjustmentPlan | null;
  schedules: VisitSchedule[];
  pharmacists: Pharmacist[];
  targetDate: string;
}): ConflictPlanAdoptionDraft {
  if (!args.plan) {
    return { ok: false, plan: null, reason: '採用できる担当変更案がありません' };
  }
  if (args.plan.id !== 'plan_a') {
    return { ok: false, plan: args.plan, reason: '担当変更案ではないため自動採用できません' };
  }

  const targetSchedule = args.schedules.find(
    (schedule) => schedule.id === args.plan?.targetScheduleIds[0],
  );
  if (!targetSchedule) {
    return { ok: false, plan: args.plan, reason: '対象の訪問予定を特定できません' };
  }
  if (targetSchedule.confirmed_at) {
    return {
      ok: false,
      plan: args.plan,
      reason: '電話確定済みの訪問予定は担当変更できません',
    };
  }
  if (!CONFLICT_REORDERABLE_STATUSES.has(targetSchedule.schedule_status)) {
    return {
      ok: false,
      plan: args.plan,
      reason: '完了済みまたは中止済みの訪問予定は担当変更できません',
    };
  }

  const candidate = args.pharmacists.find((pharmacist) => {
    if (pharmacist.id === targetSchedule.pharmacist_id) return false;
    return !args.schedules.some(
      (schedule) =>
        schedule.id !== targetSchedule.id &&
        schedule.pharmacist_id === pharmacist.id &&
        scheduleDateKey(schedule) === args.targetDate &&
        schedulesOverlap(targetSchedule, schedule),
    );
  });

  if (!candidate) {
    return {
      ok: false,
      plan: args.plan,
      reason: '重なりなく受けられる薬剤師が見つかりません',
    };
  }

  const routeOrder =
    Math.max(
      0,
      ...args.schedules
        .filter(
          (schedule) =>
            schedule.id !== targetSchedule.id &&
            schedule.pharmacist_id === candidate.id &&
            scheduleDateKey(schedule) === args.targetDate,
        )
        .map((schedule) => schedule.route_order ?? 0),
    ) + 1;

  return {
    ok: true,
    plan: args.plan,
    targetSchedule,
    targetPharmacist: candidate,
    routeOrder,
  };
}

async function createConflictReconfirmationTask(args: {
  orgId: string;
  scheduleId: string;
  targetDate: string;
  planId?: AdjustmentPlan['id'];
  expectedScheduleUpdatedAt?: string;
}) {
  const response = await fetch(
    `/api/visit-schedules/${encodeURIComponent(args.scheduleId)}/conflict-reconfirmation`,
    {
      method: 'POST',
      headers: buildOrgJsonHeaders(args.orgId),
      body: JSON.stringify({
        target_date: args.targetDate,
        ...(args.planId ? { plan_id: args.planId } : {}),
        ...(args.expectedScheduleUpdatedAt
          ? { expected_schedule_updated_at: args.expectedScheduleUpdatedAt }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '患者再確認依頼の作成に失敗しました');
  }
  return response.json();
}

function toConflictInput(
  schedule: VisitSchedule,
  pharmacistNameById: ReadonlyMap<string, string>,
): ConflictScheduleInput {
  return {
    scheduleId: schedule.id,
    patientName: schedule.case_.patient.name,
    pharmacistId: schedule.pharmacist_id,
    pharmacistName: pharmacistNameById.get(schedule.pharmacist_id) ?? null,
    startMinutes: isoTimeToMinutes(schedule.time_window_start),
    endMinutes: isoTimeToMinutes(schedule.time_window_end),
    priority: schedule.priority,
    visitType: schedule.visit_type,
    confirmed: Boolean(schedule.confirmed_at),
    vehicleResourceId: schedule.vehicle_resource?.id ?? null,
    vehicleLabel: schedule.vehicle_resource?.label ?? null,
  };
}

export function ConflictResolutionContent({ initialDate }: { initialDate?: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const syncSearchParams = useSyncedSearchParams();
  const [targetDate, setTargetDate] = useState(
    () => initialDate ?? format(new Date(), 'yyyy-MM-dd'),
  );
  const [adoptedPlanId, setAdoptedPlanId] = useState<AdjustmentPlan['id'] | null>(null);
  const [reconfirmationTaskScheduleId, setReconfirmationTaskScheduleId] = useState<string | null>(
    null,
  );
  const handleSelectDate = (date: string) => {
    setTargetDate(date);
    // plan id は plan_a/b/c の安定リテラルのため、日付を跨いで採用状態を残すと
    // 別日の同名プランが「採用済み」に誤表示される。対象日変更で採用状態をクリアする。
    setAdoptedPlanId(null);
    setReconfirmationTaskScheduleId(null);
    syncSearchParams({ date });
  };
  const dateNavigator = (
    <ScheduleDateNavigator
      value={targetDate}
      onSelectDate={handleSelectDate}
      inputId="conflict-target-date"
      ariaLabel="重なりを確認する対象日"
    />
  );

  const schedulesQuery = useQuery({
    queryKey: ['visit-schedules', 'conflicts', orgId, targetDate],
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

  const pharmacistsQuery = useQuery({
    queryKey: ['pharmacists', orgId, 'conflicts'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', { headers: buildOrgHeaders(orgId) });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{ data: Pharmacist[] }>;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const pharmacistNameById = useMemo(
    () =>
      new Map(
        (pharmacistsQuery.data?.data ?? []).map((pharmacist) => [pharmacist.id, pharmacist.name]),
      ),
    [pharmacistsQuery.data],
  );

  const viewModel = useMemo(() => {
    return buildScheduleConflictViewModel(
      schedules.map((schedule) => toConflictInput(schedule, pharmacistNameById)),
    );
  }, [schedules, pharmacistNameById]);

  const recommendedPlan = useMemo(
    () => viewModel.plans.find((plan) => plan.recommended) ?? viewModel.plans[0] ?? null,
    [viewModel.plans],
  );
  const planA = useMemo(
    () => viewModel.plans.find((plan) => plan.id === 'plan_a') ?? null,
    [viewModel.plans],
  );
  const adoptionDraft = useMemo(
    () =>
      findConflictPlanAdoptionDraft({
        plan: planA,
        schedules,
        pharmacists: pharmacistsQuery.data?.data ?? [],
        targetDate,
      }),
    [planA, schedules, pharmacistsQuery.data, targetDate],
  );
  const reconfirmationTargetSchedule = useMemo(() => {
    const targetScheduleId =
      recommendedPlan?.targetScheduleIds[0] ?? viewModel.rows[0]?.scheduleId ?? null;
    return targetScheduleId
      ? (schedules.find((schedule) => schedule.id === targetScheduleId) ?? null)
      : null;
  }, [recommendedPlan, schedules, viewModel.rows]);

  const invalidateConflictQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'conflicts', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['visit-schedules'] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-day-board', orgId, targetDate] }),
    ]);
  };

  const applyPlanMutation = useMutation({
    mutationFn: async (draft: Extract<ConflictPlanAdoptionDraft, { ok: true }>) =>
      applyVisitScheduleRouteUpdates({
        orgId,
        updates: [
          {
            scheduleId: draft.targetSchedule.id,
            scheduled_date: targetDate,
            pharmacist_id: draft.targetPharmacist.id,
            route_order: draft.routeOrder,
            expected_route_order: draft.targetSchedule.route_order,
          },
        ],
        confirmationContext: {
          source: 'schedule_conflict_resolution',
          date: targetDate,
          pharmacist_id: draft.targetPharmacist.id,
          target_count: 1,
          route_order_diff_count: 1,
        },
      }),
    onSuccess: async (_data, draft) => {
      setAdoptedPlanId(draft.plan.id);
      await invalidateConflictQueries();
      toast.success(`担当を${draft.targetPharmacist.name}へ変更しました`);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '訪問予定の順路更新に失敗しました'));
    },
  });

  const reconfirmationMutation = useMutation({
    mutationFn: async (schedule: VisitSchedule) =>
      createConflictReconfirmationTask({
        orgId,
        scheduleId: schedule.id,
        targetDate,
        planId: recommendedPlan?.id,
        expectedScheduleUpdatedAt: schedule.updated_at,
      }),
    onSuccess: async (_data, schedule) => {
      setReconfirmationTaskScheduleId(schedule.id);
      await Promise.all([
        invalidateConflictQueries(),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
      ]);
      toast.success('患者再確認依頼を作成しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '患者再確認依頼の作成に失敗しました'));
    },
  });

  if (!orgId || schedulesQuery.isLoading || pharmacistsQuery.isLoading) {
    return (
      <div
        className="grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr] xl:gap-5"
        role="status"
        aria-label="重なり読み込み中"
      >
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (schedulesQuery.isError) {
    return (
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">予定の重なりを直す</h1>
          {dateNavigator}
        </div>
        <ErrorState
          variant="server"
          title="重なりを表示できません"
          description="対象日の訪問予定の取得に失敗しました。再試行してください。"
          onRetry={() => void schedulesQuery.refetch()}
        />
      </div>
    );
  }

  if (pharmacistsQuery.isError) {
    return (
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">予定の重なりを直す</h1>
          {dateNavigator}
        </div>
        <ErrorState
          variant="server"
          title="薬剤師一覧を取得できませんでした"
          description="薬剤師名と代替担当候補を確認できないため、重なり判定を表示できません。通信状態を確認して再試行してください。"
          onRetry={() => void pharmacistsQuery.refetch()}
        />
      </div>
    );
  }

  if (!viewModel.hasConflict) {
    return (
      <div
        className="rounded-xl border border-border/70 bg-card p-6"
        data-testid="schedule-conflict-resolution"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-bold text-foreground">予定の重なりを直す</h1>
          {dateNavigator}
        </div>
        <EmptyState
          className="mt-4"
          icon={CalendarCheck2}
          title={`${targetDate} の予定に重なりはありません`}
          description="同一薬剤師の時間帯重複や同一社用車の同時使用は検知されませんでした。"
          action={{ href: '/schedules', label: 'スケジュールへ戻る' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-bold text-foreground">予定の重なりを直す</h1>
        {dateNavigator}
      </div>
      <div
        className="grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr] xl:gap-5"
        data-testid="schedule-conflict-resolution"
      >
        {/* 重なっている予定 */}
        <section
          className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[760px]"
          aria-label="重なっている予定"
          data-testid="conflict-overlap-table"
        >
          <h2 className="text-base font-bold text-foreground">重なっている予定</h2>
          <div className="mt-4">
            <DataTable
              columns={conflictRowColumns}
              data={viewModel.rows}
              getRowId={(row, index) => `${row.kind}:${row.scheduleId}:${index}`}
            />
          </div>
        </section>

        {/* おすすめの調整案 */}
        <section
          className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[760px]"
          aria-label="おすすめの調整案"
          data-testid="conflict-adjustment-plans"
        >
          <h2 className="text-base font-bold text-foreground">おすすめの調整案</h2>
          <div className="flex flex-col gap-3">
            {viewModel.plans.map((plan) => {
              const isAdopted = adoptedPlanId === plan.id;
              return (
                <article
                  key={plan.id}
                  className={`rounded-lg border p-4 ${PLAN_CARD_TONE[plan.tone]} ${
                    isAdopted ? 'ring-2 ring-primary/60' : ''
                  }`}
                  data-testid="conflict-plan-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-bold text-foreground">{plan.title}</h3>
                    {isAdopted ? <StateBadge role="done">採用</StateBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.note}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* 次にやること */}
        <section
          className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[760px]"
          aria-label="次にやること"
          data-testid="conflict-next-actions"
        >
          <h2 className="text-base font-bold text-foreground">次にやること</h2>
          <p className="text-sm text-muted-foreground">
            正式決定済みの患者さんはなるべく動かさず、推奨案から調整します。
          </p>
          {viewModel.hasConflict ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={
                  !adoptionDraft.ok ||
                  applyPlanMutation.isPending ||
                  adoptedPlanId === adoptionDraft.plan?.id
                }
                onClick={() => {
                  if (!adoptionDraft.ok) {
                    toast.error(adoptionDraft.reason);
                    return;
                  }
                  applyPlanMutation.mutate(adoptionDraft);
                }}
              >
                {applyPlanMutation.isPending
                  ? '反映中...'
                  : adoptedPlanId === adoptionDraft.plan?.id
                    ? '採用済み'
                    : '案Aを採用する'}
              </Button>
              {!adoptionDraft.ok ? (
                <p className="text-xs text-state-confirm">{adoptionDraft.reason}</p>
              ) : null}
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="w-full text-primary"
                disabled={
                  !reconfirmationTargetSchedule ||
                  reconfirmationMutation.isPending ||
                  reconfirmationTaskScheduleId === reconfirmationTargetSchedule.id
                }
                onClick={() => {
                  if (!reconfirmationTargetSchedule) {
                    toast.error('再確認対象の訪問予定を特定できません');
                    return;
                  }
                  reconfirmationMutation.mutate(reconfirmationTargetSchedule);
                }}
              >
                {reconfirmationMutation.isPending
                  ? '依頼作成中...'
                  : reconfirmationTargetSchedule &&
                      reconfirmationTaskScheduleId === reconfirmationTargetSchedule.id
                    ? '再確認依頼済み'
                    : '患者さんへ再確認を依頼'}
              </Button>
            </div>
          ) : null}
          <p className="mt-auto text-sm text-muted-foreground">
            <Link href="/schedules" className="font-medium text-primary hover:underline">
              スケジュールへ戻る →
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
