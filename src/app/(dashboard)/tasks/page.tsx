import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { TasksContent } from './tasks-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readTasksState } from './tasks-query-state';

export const metadata: Metadata = { title: 'タスク — PH-OS' };

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readTasksState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Operational Tasks"
        title="タスク"
        description="運用タスクの一覧・フィルタ・一括完了"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              期限、種類、ワークフロー起点を先に確認し、今日処理すべきタスクから進めます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/my-day', label: 'My Day' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>
      <Suspense fallback={<Loading />}>
        <TasksContent
          initialAssigned={initialState.initialAssigned}
          initialStatus={initialState.initialStatus}
          initialTaskType={initialState.initialTaskType}
          initialPriority={initialState.initialPriority}
          initialContext={initialState.initialContext}
        />
      </Suspense>
    </PageScaffold>
  );
}
