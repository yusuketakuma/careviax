import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { BillingDashboardContent } from './billing-dashboard-content';

export const metadata: Metadata = {
  title: '請求支援ダッシュボード — CareViaX',
};

export default function BillingPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="請求支援ダッシュボード"
        description="算定根拠・月次締め・要確認候補を SSOT ベースで整理します。"
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
    </div>
  );
}
