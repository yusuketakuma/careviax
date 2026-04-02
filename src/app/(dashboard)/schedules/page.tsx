import { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarPlus } from 'lucide-react';
import { ScheduleDayView } from './day-view';
import { CalendarView } from './calendar-view';
import { ScheduleViewToggle } from './schedule-view-toggle';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: '訪問スケジュール — CareViaX',
};

type SchedulesPageProps = {
  searchParams?: Promise<{
    view?: string;
  }>;
};

export default async function SchedulesPage({ searchParams }: SchedulesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeView =
    resolvedSearchParams?.view === 'calendar' ? 'calendar' : 'list';

  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="訪問スケジュール"
        description="薬剤師の訪問予定を管理します"
        action={{
          href: '/schedules#planner',
          label: '新規訪問予定',
          icon: <CalendarPlus className="size-4" aria-hidden="true" />,
        }}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PageShortcutLinks
            links={[
              { href: '/schedules/proposals', label: '提案一覧' },
              { href: '/communications/requests', label: '依頼・照会' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
          <ScheduleViewToggle activeView={activeView} />
        </div>
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        {activeView === 'calendar' ? <CalendarView /> : <ScheduleDayView />}
      </Suspense>
    </div>
  );
}
