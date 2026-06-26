import { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarView } from './calendar-view';
import { ScheduleTeamBoard } from './schedule-team-board';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '訪問スケジュール — PH-OS',
};

type SchedulesPageProps = {
  searchParams?: Promise<{
    view?: string;
    date?: string;
  }>;
};

/**
 * /schedules。ビューポート最上部は new_03_schedule の全員スケジュールボード
 * (見出し帯+日/週トグル → 全員ガント+リスク警告+未確定 → 右レール)。
 */
export default async function SchedulesPage({ searchParams }: SchedulesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeView = resolvedSearchParams?.view === 'calendar' ? 'calendar' : 'list';
  const initialSelectedDate =
    resolvedSearchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : undefined;

  return (
    <PageScaffold variant="bare">
      <div className={activeView === 'list' ? 'xl:min-h-[calc(100dvh-4rem)]' : undefined}>
        <h1 className="sr-only">訪問予定</h1>
        <ScheduleTeamBoard initialDate={initialSelectedDate} activeView={activeView} />
        {activeView === 'calendar' ? (
          <div className="mt-4">
            <Suspense fallback={<Loading />}>
              <CalendarView />
            </Suspense>
          </div>
        ) : null}
      </div>
    </PageScaffold>
  );
}
