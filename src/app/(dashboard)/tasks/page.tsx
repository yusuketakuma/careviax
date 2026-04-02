import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { TasksContent } from './tasks-content';

export const metadata: Metadata = { title: 'タスク — CareViaX' };

export default function TasksPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="タスク"
        description="運用タスクの一覧・フィルタ・一括完了"
      >
        <PageShortcutLinks
          links={[
            { href: '/my-day', label: 'My Day' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>
      <Suspense fallback={<Loading />}>
        <TasksContent />
      </Suspense>
    </div>
  );
}
