import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminDashboardShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AdminDashboardContent } from './admin-dashboard-content';
import { MasterHubContent } from './master-hub-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'マスター — PH-OS',
};

/**
 * /admin。ビューポート最上部は new 13_master のマスター鮮度ハブ
 * (MasterHubContent: 5 マスターカード + 右レール 3 点セット)。
 * 旧・管理者ダッシュボード(管理サマリー/設定・マスター整備/月間進捗/滞留と例外)は
 * 管理サマリーとして下部に温存する。
 */
export default function AdminDashboardPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <MasterHubContent />
      </Suspense>

      <div className="rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-6 py-5">
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
      </div>

      <Suspense fallback={<Loading />}>
        <AdminDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
