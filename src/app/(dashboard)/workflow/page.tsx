import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { WorkflowDashboardContent } from './workflow-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'ワークフローダッシュボード — CareViaX',
};

export default function WorkflowDashboardPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Workflow Control"
        title="ワークフローダッシュボード"
        description="処方サイクルの工程別集計・例外・連携状況を確認します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              まず工程別の滞留件数と例外を確認し、その後に各ワークベンチや連携画面へ進みます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
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
    </PageScaffold>
  );
}
