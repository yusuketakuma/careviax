import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { WorkflowDashboardContent } from './workflow-dashboard-content';

export const metadata: Metadata = {
  title: 'ワークフローダッシュボード — CareViaX',
};

export default function WorkflowDashboardPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="ワークフローダッシュボード"
        description="処方サイクルの工程別集計・例外・連携状況を確認します"
      >
        <PageShortcutLinks
          links={[
            { href: '/conferences', label: '多職種連携' },
            { href: '/communications/requests', label: '依頼・照会' },
            { href: '/notifications', label: '通知' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <WorkflowDashboardContent />
      </Suspense>
    </div>
  );
}
