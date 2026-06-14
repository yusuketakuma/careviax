'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { Pharmacist, VisitSchedule } from '../day-view.shared';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import {
  buildScheduleConflictViewModel,
  type AdjustmentPlan,
  type AdjustmentPlanTone,
  type ConflictScheduleInput,
} from '@/server/services/visit-schedule-conflicts';

/**
 * p0_19「予定の重なりを直す」: 本日の訪問予定から、同一薬剤師の時間帯重複と
 * 同一社用車の同時使用を検知し、左に重なり一覧テーブル、中央に調整案 A/B/C、
 * 右に「次にやること」(推奨案の採用 / 患者再確認)を提示する読取専用の調整画面。
 * 検知・調整案合成のロジックは server/services/visit-schedule-conflicts.ts に集約する。
 */

const PLAN_CARD_TONE: Record<AdjustmentPlanTone, string> = {
  blue: 'border-sky-200 bg-sky-50/60',
  amber: 'border-amber-200 bg-amber-50/40',
  slate: 'border-border/70 bg-card',
};

/** @db.Time 由来の ISO 文字列を 0 時からの分へ(ローカル時刻で解釈) */
function isoTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getHours() * 60 + parsed.getMinutes();
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
  const [targetDate] = useState(() => initialDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [adoptedPlanId, setAdoptedPlanId] = useState<AdjustmentPlan['id'] | null>(null);

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
      const res = await fetch('/api/pharmacists', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{ data: Pharmacist[] }>;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const pharmacistNameById = useMemo(
    () =>
      new Map((pharmacistsQuery.data?.data ?? []).map((pharmacist) => [pharmacist.id, pharmacist.name])),
    [pharmacistsQuery.data],
  );

  const viewModel = useMemo(() => {
    const schedules = schedulesQuery.data ?? [];
    return buildScheduleConflictViewModel(
      schedules.map((schedule) => toConflictInput(schedule, pharmacistNameById)),
    );
  }, [schedulesQuery.data, pharmacistNameById]);

  const recommendedPlan = useMemo(
    () => viewModel.plans.find((plan) => plan.recommended) ?? viewModel.plans[0] ?? null,
    [viewModel.plans],
  );

  if (!orgId || schedulesQuery.isLoading || pharmacistsQuery.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr] xl:gap-5" role="status" aria-label="重なり読み込み中">
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
          title="重なりを表示できません"
          description="本日の訪問予定の取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void schedulesQuery.refetch() }}
        />
      </div>
    );
  }

  if (!viewModel.hasConflict) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-6" data-testid="schedule-conflict-resolution">
        <h1 className="text-base font-bold text-foreground">予定の重なりを直す</h1>
        <EmptyState
          className="mt-4"
          icon={CalendarCheck2}
          title={`本日(${targetDate})の予定に重なりはありません`}
          description="同一薬剤師の時間帯重複や同一社用車の同時使用は検知されませんでした。"
          action={{ href: '/schedules', label: 'スケジュールへ戻る' }}
        />
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr] xl:gap-5"
      data-testid="schedule-conflict-resolution"
    >
      <h1 className="sr-only">予定の重なりを直す</h1>

      {/* 重なっている予定 */}
      <section
        className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:min-h-[760px]"
        aria-label="重なっている予定"
        data-testid="conflict-overlap-table"
      >
        <h2 className="text-base font-bold text-foreground">重なっている予定</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">
                  対象
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  時間
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  内容
                </th>
              </tr>
            </thead>
            <tbody>
              {viewModel.rows.map((row, index) => (
                <tr
                  key={`${row.kind}:${row.scheduleId}:${index}`}
                  className="border-t border-border/60"
                  data-testid="conflict-row"
                >
                  <td className="px-3 py-3 align-top font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      {row.subject}
                      {row.confirmed ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700">
                          確定
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top tabular-nums text-foreground">{row.timeLabel}</td>
                  <td className="px-3 py-3 align-top text-foreground">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  {isAdopted ? (
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      採用
                    </Badge>
                  ) : null}
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
        {recommendedPlan ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={adoptedPlanId === recommendedPlan.id}
              onClick={() => {
                setAdoptedPlanId(recommendedPlan.id);
                toast.success(`${recommendedPlan.title.split('：')[0] ?? '推奨案'}を採用しました`);
              }}
            >
              {adoptedPlanId === recommendedPlan.id ? '採用済み' : '案Aを採用する'}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full text-primary"
              onClick={() => toast.info('患者さんへの再確認を依頼に追加してください')}
            >
              患者さんへ再確認
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
  );
}
