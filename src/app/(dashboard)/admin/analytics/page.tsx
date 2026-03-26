import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { AnalyticsContent } from './analytics-content';

export const metadata: Metadata = {
  title: 'KPI分析 — CareViaX',
};

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          KPI分析ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          請求 SSOT と運用実績を月次で分析します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <AnalyticsContent />
      </Suspense>
    </div>
  );
}
