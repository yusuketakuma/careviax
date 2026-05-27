import { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarPlus } from 'lucide-react';
import { ScheduleDayView } from './day-view';
import { CalendarView } from './calendar-view';
import { ScheduleViewToggle } from './schedule-view-toggle';
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
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Schedule Management"
        title="訪問スケジュール"
        description="全体予定と個人予定を確認し、訪問提案、準備、連携依頼へつなげる管理画面です。"
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
        {activeView === 'calendar' ? (
          <CalendarView />
        ) : (
          <ScheduleDayView
            initialSelectedDate={initialSelectedDate}
            initialTab={initialTab}
            highlightedScheduleId={highlightedScheduleId}
          />
        )}
      </Suspense>
    </PageScaffold>
  );
}
