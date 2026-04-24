import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminDashboardShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AdminDashboardContent } from './admin-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '管理者ダッシュボード — CareViaX',
};

export default function AdminDashboardPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        eyebrow="Admin Overview"
        title="管理者ダッシュボード"
        description="月間進捗、記録滞留、報告送達、例外残件、設定・マスター整備を一画面で確認します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              月間進捗、残件、例外、設定・マスター整備、運用品質を上から確認し、必要な管理画面へ進みます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
        shortcuts={getAdminDashboardShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <AdminDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
