import { Suspense } from 'react';
import { type Metadata } from 'next';
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
        eyebrow="運用タスク"
        title="タスク"
        description="未完了タスクを期限順に処理し、必要な業務画面へ移動"
      />
      <Suspense fallback={<Loading label="タスクを読み込み中..." />}>
        <TasksContent
          initialAssigned={initialState.initialAssigned}
          initialStatus={initialState.initialStatus}
          initialTaskType={initialState.initialTaskType}
          initialPriority={initialState.initialPriority}
          initialContext={initialState.initialContext}
          initialWorkRequestType={initialState.initialWorkRequestType}
          initialWorkRequestTitle={initialState.initialWorkRequestTitle}
          initialWorkRequestDescription={initialState.initialWorkRequestDescription}
          initialRelatedEntityType={initialState.initialRelatedEntityType}
          initialRelatedEntityId={initialState.initialRelatedEntityId}
        />
      </Suspense>
    </PageScaffold>
  );
}
