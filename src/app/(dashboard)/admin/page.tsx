import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminDashboardShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AdminDashboardContent } from './admin-dashboard-content';

export const metadata: Metadata = {
  title: '管理者ダッシュボード — CareViaX',
};

export default function AdminDashboardPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="管理者ダッシュボード"
        description="月間進捗、記録滞留、報告送達、例外残件を一画面で確認します。"
        shortcuts={getAdminDashboardShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <AdminDashboardContent />
      </Suspense>
    </div>
  );
}
