import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { WorkflowDashboardContent } from './workflow-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readWorkflowState } from './workflow-query-state';

export const metadata: Metadata = {
  title: 'ワークフローダッシュボード — PH-OS',
};

type WorkflowDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkflowDashboardPage({ searchParams }: WorkflowDashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readWorkflowState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Workflow Control"
        title="ワークフローダッシュボード"
        description="処方登録から報告書までの主業務フローと、工程別の滞留・例外・連携状況を確認します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              まず 8
              工程の本流を確認し、その後に工程別の滞留件数と例外を見て、各ワークベンチや連携画面へ進みます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/workflow/pharmacy-cooperation', label: '薬局間協力' },
            { href: '/conferences', label: '多職種連携' },
            { href: '/communications/requests', label: '依頼・照会' },
            { href: '/notifications', label: '通知' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <WorkflowDashboardContent
          initialFocus={initialState.initialFocus}
          initialContext={initialState.initialContext}
        />
      </Suspense>
    </PageScaffold>
  );
}
