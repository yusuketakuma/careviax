import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { MetricsDashboardContent } from './metrics-dashboard-content';

export const metadata: Metadata = {
  title: '経営指標 — CareViaX',
};

export default function MetricsDashboardPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          経営指標ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          薬局経営に関わる主要指標のモニタリング
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <MetricsDashboardContent />
      </Suspense>
    </div>
  );
}
