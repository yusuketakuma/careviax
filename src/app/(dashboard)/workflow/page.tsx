import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { WorkflowDashboardContent } from './workflow-dashboard-content';

export const metadata: Metadata = {
  title: 'ワークフローダッシュボード — CareViaX',
};

export default function WorkflowDashboardPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          ワークフローダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          処方サイクルの工程別集計・例外・連携状況を確認します
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <WorkflowDashboardContent />
      </Suspense>
    </div>
  );
}
