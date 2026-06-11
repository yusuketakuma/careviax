import { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarPlus } from 'lucide-react';
import { ScheduleDayView } from './day-view';
import { CalendarView } from './calendar-view';
import { ScheduleTeamBoard } from './schedule-team-board';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '訪問スケジュール — PH-OS',
};

type SchedulesPageProps = {
  searchParams?: Promise<{
    view?: string;
    date?: string;
    tab?: string;
    schedule?: string;
  }>;
};

/**
 * /schedules。ビューポート最上部は new_03_schedule の全員スケジュールボード
 * (見出し帯+日/週トグル → 全員ガント+リスク警告+未確定 → 右レール)。
 * 旧 day-view(候補一覧/当日確定/施設トラッカー/ルート最適化/週間操作)は
 * 機能温存のため下部 #schedule-legacy-tools へ残置する(dashboard と同じ方針)。
 */
export default async function SchedulesPage({ searchParams }: SchedulesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeView = resolvedSearchParams?.view === 'calendar' ? 'calendar' : 'list';
  const initialSelectedDate =
    resolvedSearchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : undefined;
  const initialTab =
    resolvedSearchParams?.tab === 'confirmed' || resolvedSearchParams?.tab === 'proposals'
      ? resolvedSearchParams.tab
      : undefined;
  const highlightedScheduleId = resolvedSearchParams?.schedule ?? undefined;

  return (
    <PageScaffold variant="bare">
      {/* 新デザイン: 全員スケジュールボード(週トグル時は見出しのみ+下にカレンダー)。
          xl:min-h は静止画ビューポート(1600x1000)内に旧 UI が写り込まないための余白 */}
      <div className={activeView === 'list' ? 'xl:min-h-[920px]' : undefined}>
        <ScheduleTeamBoard initialDate={initialSelectedDate} activeView={activeView} />
        {activeView === 'calendar' ? (
          <div className="mt-4">
            <Suspense fallback={<Loading />}>
              <CalendarView />
            </Suspense>
          </div>
        ) : null}
      </div>

      {/* 旧 UI 温存(ビューポート下部): 週間操作・候補/確定タブ・施設トラッカー・ルート最適化 */}
      <div id="schedule-legacy-tools" className="space-y-3 sm:space-y-4 xl:space-y-5">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
          <WorkflowPageHeader
            eyebrow="Schedule Management"
            title="訪問スケジュール"
            description="全体予定と個人予定を確認し、訪問提案、準備、連携依頼へつなげる管理画面です。"
            className="mb-0"
            action={{
              href: '/schedules#planner',
              label: '新規訪問予定',
              icon: <CalendarPlus className="size-4" aria-hidden="true" />,
            }}
            supportingContent={
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">最初の確認事項</p>
                <p className="text-sm text-muted-foreground">
                  今日の全体スケジュール、自分の予定、未承認提案や未完了準備を先に確認します。
                </p>
              </div>
            }
            mainWorkflowSteps={['schedules']}
            childrenLabel="関連導線"
          >
            <PageShortcutLinks
              links={[
                { href: '/schedules/proposals', label: '提案一覧' },
                { href: '/communications/requests', label: '依頼・照会' },
                { href: '/workflow', label: 'ワークフロー' },
              ]}
            />
          </WorkflowPageHeader>
        </div>

        {activeView === 'list' ? (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
            <Suspense fallback={<Loading />}>
              <ScheduleDayView
                initialSelectedDate={initialSelectedDate}
                initialTab={initialTab}
                highlightedScheduleId={highlightedScheduleId}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
    </PageScaffold>
  );
}
