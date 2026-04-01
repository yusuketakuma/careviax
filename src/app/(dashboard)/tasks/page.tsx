import { Suspense } from 'react';
import { type Metadata } from 'next';
import { Loading } from '@/components/ui/loading';
import { TasksContent } from './tasks-content';

export const metadata: Metadata = { title: 'タスク — CareViaX' };

export default function TasksPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">タスク</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          運用タスクの一覧・フィルタ・一括完了
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <TasksContent />
      </Suspense>
    </div>
  );
}
