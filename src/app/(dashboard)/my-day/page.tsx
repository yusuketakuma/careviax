import type { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { MyDayContent } from './my-day-content';
import { readMyDayState } from './my-day-query-state';

export const metadata: Metadata = {
  title: 'My Day — PH-OS',
};

type MyDayPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyDayPage({ searchParams }: MyDayPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readMyDayState(resolvedSearchParams);

  return (
    <PageScaffold stackClassName="space-y-0 [&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent [&>*]:p-0 [&>*]:shadow-none">
      <div className="border-b border-border px-4 py-3 sm:px-6">
        <WorkflowPageIntro
          backHref="/dashboard"
          backLabel="ホームへ戻る"
          eyebrow="Today Focus"
          title="My Day"
          description="今日の担当訪問・未完了タスク・優先対応をまとめて確認"
          className="mb-0"
        />
      </div>
      <MyDayContent
        initialFocus={initialState.initialFocus}
        initialVisitFilter={initialState.initialVisitFilter}
        initialTaskFilter={initialState.initialTaskFilter}
        initialContext={initialState.initialContext}
      />
    </PageScaffold>
  );
}
