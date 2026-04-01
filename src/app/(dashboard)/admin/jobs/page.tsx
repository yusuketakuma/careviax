import { Suspense } from 'react';
import { type Metadata } from 'next';
import { Loading } from '@/components/ui/loading';
import { JobsDashboardContent } from './jobs-dashboard-content';

export const metadata: Metadata = { title: 'ジョブ監視 — CareViaX' };

export default function JobsDashboardPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">ジョブ監視</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          IntegrationJob の実行状況・エラーログ・手動再実行
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <JobsDashboardContent />
      </Suspense>
    </div>
  );
}
