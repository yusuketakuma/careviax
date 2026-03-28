import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { AdminDashboardContent } from './admin-dashboard-content';

export const metadata: Metadata = {
  title: '管理者ダッシュボード — CareViaX',
};

export default function AdminDashboardPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">管理者ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          月間進捗、記録滞留、報告送達、例外残件を一画面で確認します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <AdminDashboardContent />
      </Suspense>
    </div>
  );
}
