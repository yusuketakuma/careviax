import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { BillingDashboardContent } from './billing-dashboard-content';

export const metadata: Metadata = {
  title: '請求支援ダッシュボード — CareViaX',
};

export default function BillingPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          請求支援ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          算定根拠・月次締め・要確認候補を SSOT ベースで整理します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <BillingDashboardContent />
      </Suspense>
    </div>
  );
}
