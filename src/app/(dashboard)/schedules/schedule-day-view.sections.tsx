'use client';

import Link from 'next/link';
import { addDays, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PhoneCall,
  RefreshCw,
  Route,
  Shuffle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSection } from '@/components/layout/page-section';
import { ScheduleMetricCard } from './schedule-metric-card';
import { toDateKey, type CaseOption, type Proposal, type VisitSchedule } from './day-view.shared';
import type { WeekProposalStats } from './schedule-day-view.helpers';

type ScheduleBoardMetricsProps = {
  stats: WeekProposalStats;
  headingLevel?: 2 | 3;
};

export function ScheduleBoardMetrics({ stats, headingLevel = 2 }: ScheduleBoardMetricsProps) {
  return (
    <PageSection
      title="週次訪問の進捗"
      description="候補、確定、変更待ち、緊急影響を同じ基準で確認します"
      contentClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
      headingLevel={headingLevel}
    >
      <ScheduleMetricCard
        title="承認待ち"
        value={stats.approvalPending}
        description="担当者が候補を確認する必要があります"
        icon={CalendarClock}
      />
      <ScheduleMetricCard
        title="架電待ち"
        value={stats.contactPending}
        description="患者連絡で日時を確定させる段階です"
        icon={PhoneCall}
      />
      <ScheduleMetricCard
        title="確定訪問"
        value={stats.confirmedSchedules}
        description="電話確定済みで原則変更しない予定です"
        icon={CheckCircle2}
      />
      <ScheduleMetricCard
        title="代替割当"
        value={stats.fallbackAssignments}
        description="担当薬剤師不在のため他薬剤師へエスカレーション"
        icon={Shuffle}
      />
      <ScheduleMetricCard
        title="変更承認待ち"
        value={stats.pendingOverrides}
        description="確定後の変更は専用リスケで管理します"
        icon={RefreshCw}
      />
      <ScheduleMetricCard
        title="緊急影響"
        value={stats.emergencyImpacts}
        description="緊急訪問や割込対応の影響を見える化"
        icon={AlertTriangle}
      />
      <ScheduleMetricCard
        title="確定ロック"
        value={stats.lockedSchedules}
        description="電話確定済みで原則変更しません"
        icon={CheckCircle2}
      />
    </PageSection>
  );
}

type RouteBoardSummaryProps = {
  weekStart: Date;
  weekEnd: Date;
  selectedDay: Date;
  pharmacistName: string | null;
  headingLevel?: 2 | 3;
};

export function RouteBoardSummary({
  weekStart,
  weekEnd,
  selectedDay,
  pharmacistName,
  headingLevel = 2,
}: RouteBoardSummaryProps) {
  return (
    <PageSection
      title="週間ルート運用"
      description="服薬最終日より前の訪問候補を生成し、患者住所と既存訪問順からルート効率を加味して提案します"
      className="overflow-hidden bg-muted/30 ring-1 ring-border"
      contentClassName="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"
      headingLevel={headingLevel}
    >
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Weekly Route Board
        </p>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          電話合意が取れた候補だけを確定し、確定後の変更は専用のリスケジュール操作で扱います。
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl border border-border bg-card/70 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">対象週</span>
          <span className="font-medium text-foreground">
            {format(weekStart, 'M/d', { locale: ja })} - {format(weekEnd, 'M/d', { locale: ja })}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">選択日</span>
          <span className="font-medium text-foreground">
            {format(selectedDay, 'yyyy年M月d日(E)', { locale: ja })}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">担当薬剤師</span>
          <span className="font-medium text-foreground">{pharmacistName ?? '未設定'}</span>
        </div>
        <div className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-xs text-state-confirm">
          電話で患者合意が取れた候補のみ確定できます。確定後の変更は リスケジュール操作で行います。
        </div>
      </div>
    </PageSection>
  );
}

type WeeklyScheduleControlsProps = {
  visibleDays: Date[];
  selectedDate: string;
  selectedDay: Date;
  proposals: Proposal[];
  schedules: VisitSchedule[];
  billedDateSet: Set<string>;
  nextBillableDate: string | null;
  suggestedDateSet: Set<string>;
  onSelectDate: (dateKey: string) => void;
  headingLevel?: 2 | 3;
};

export function WeeklyScheduleControls({
  visibleDays,
  selectedDate,
  selectedDay,
  proposals,
  schedules,
  billedDateSet,
  nextBillableDate,
  suggestedDateSet,
  onSelectDate,
  headingLevel = 2,
}: WeeklyScheduleControlsProps) {
  return (
    <PageSection
      title="週間スケジュール"
      description="候補件数と確定件数を見ながら日別に切り替えます"
      headingLevel={headingLevel}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => onSelectDate(format(addDays(selectedDay, -7), 'yyyy-MM-dd'))}
            aria-label="前週"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            className="w-[160px]"
            value={selectedDate}
            aria-label="週間スケジュールの対象日"
            onChange={(event) => onSelectDate(event.target.value)}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={() => onSelectDate(format(addDays(selectedDay, 7), 'yyyy-MM-dd'))}
            aria-label="翌週"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        {visibleDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const proposalCount = proposals.filter(
            (proposal) => toDateKey(proposal.proposed_date) === dateKey,
          ).length;
          const scheduleCount = schedules.filter(
            (schedule) => toDateKey(schedule.scheduled_date) === dateKey,
          ).length;
          const isSelected = dateKey === selectedDate;
          const isBillableHistoryDate = billedDateSet.has(dateKey);
          const isNextBillableDate = nextBillableDate === dateKey;
          const isSuggestedBillableDate = suggestedDateSet.has(dateKey);

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
              aria-pressed={isSelected}
              aria-label={`${format(day, 'yyyy年M月d日(E)', { locale: ja })} 候補${proposalCount}件 確定${scheduleCount}件`}
              className={[
                'min-w-[92px] rounded-xl border px-3 py-2 text-left transition',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background hover:border-primary/40',
              ].join(' ')}
            >
              <div className="text-xs">{format(day, 'M/d(E)', { locale: ja })}</div>
              <div className="mt-1 text-[11px] opacity-80">
                候補 {proposalCount} / 確定 {scheduleCount}
              </div>
              {(isBillableHistoryDate || isNextBillableDate) && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {isBillableHistoryDate && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      算定済
                    </span>
                  )}
                  {isNextBillableDate && (
                    <span className="rounded bg-state-done/10 px-1.5 py-0.5 text-state-done">
                      次回算定可
                    </span>
                  )}
                  {!isNextBillableDate && isSuggestedBillableDate && (
                    <span className="rounded bg-tag-info/10 px-1.5 py-0.5 text-tag-info">
                      候補日
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </PageSection>
  );
}

type RelatedManagementLinksProps = {
  selectedCase: CaseOption | null;
  headingLevel?: 2 | 3;
};

export function RelatedManagementLinks({
  selectedCase,
  headingLevel = 2,
}: RelatedManagementLinksProps) {
  return (
    <PageSection
      title="関連管理"
      description="ケース担当・シフト・休日設定は管理画面で更新します"
      contentClassName="space-y-3"
      headingLevel={headingLevel}
    >
      <Link
        href="/admin/shifts"
        className="flex items-center justify-between rounded-xl border px-3 py-3 transition hover:bg-muted/30"
      >
        <div>
          <p className="font-medium text-foreground">薬剤師・シフト管理</p>
          <p className="text-xs text-muted-foreground">薬剤師登録、休日登録、月間シフト編集</p>
        </div>
        <Route className="size-4 text-muted-foreground" />
      </Link>
      {selectedCase ? (
        <Link
          href={`/patients/${selectedCase.patient.id}`}
          className="flex items-center justify-between rounded-xl border px-3 py-3 transition hover:bg-muted/30"
        >
          <div>
            <p className="font-medium text-foreground">担当薬剤師の割当</p>
            <p className="text-xs text-muted-foreground">患者ケースで主担当薬剤師を設定します</p>
          </div>
          <Shuffle className="size-4 text-muted-foreground" />
        </Link>
      ) : (
        <div
          aria-disabled="true"
          className="flex items-center justify-between rounded-xl border px-3 py-3 opacity-60"
        >
          <div>
            <p className="font-medium text-foreground">担当薬剤師の割当</p>
            <p className="text-xs text-muted-foreground">
              対象ケースを選択すると患者ケースへ移動できます
            </p>
          </div>
          <Shuffle className="size-4 text-muted-foreground" />
        </div>
      )}
    </PageSection>
  );
}
