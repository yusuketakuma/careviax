import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { BillingDashboardContent } from './billing-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '請求支援ダッシュボード — CareViaX',
};

export default function BillingPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Billing Support"
        title="請求支援ダッシュボード"
        description="算定根拠・月次締め・要確認候補を SSOT ベースで整理します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              算定ブロッカー、月次締め状況、請求候補を上から確認し、必要な対応へ進みます。
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

      <Suspense fallback={<Loading />}>
        <BillingDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
