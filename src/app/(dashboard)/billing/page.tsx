import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { BillingCheckContent } from './billing-check-content';
import { BillingDashboardContent } from './billing-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '算定チェック — PH-OS',
};

/**
 * /billing。ビューポート最上部は new 11_billing の算定チェック
 * (BillingCheckContent: 3 KPI + 疑義テーブル + 右レール 3 点セット)。
 * 旧・請求支援ダッシュボード(月次締め/主要指標/分析/月次推移/実行ワークベンチ)は
 * 月次サマリーとして下部に温存する(候補一覧は /billing/candidates のまま)。
 */
export default function BillingPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <BillingCheckContent />
      </Suspense>

      <div className="rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-6 py-5">
        <WorkflowPageHeader
          className="mb-0 space-y-0"
          eyebrow="Billing Support"
          title="月次サマリー(請求支援ダッシュボード)"
          description="算定根拠・月次締め・要確認候補を SSOT ベースで整理します。"
          supportingContent={
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">確認順序</p>
              <p className="text-sm text-muted-foreground">
                算定を止めている理由、月次締め状況、請求候補を上から確認し、必要な対応へ進みます。
              </p>
            </div>
          }
          childrenLabel="関連導線"
        >
          <PageShortcutLinks
            links={[
              { href: '/billing/candidates', label: '請求候補' },
              { href: '/admin/billing-rules', label: '請求ルール' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
        </WorkflowPageHeader>
      </div>

      <Suspense fallback={<Loading />}>
        <BillingDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
