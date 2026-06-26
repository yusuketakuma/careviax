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
    <PageScaffold stackClassName="space-y-3">
      <WorkflowPageHeader
        eyebrow="業務フロー"
        title="ワークフローダッシュボード"
        description="処方登録から報告書までの主業務フローと、工程別の滞留・例外・連携状況を確認します"
      />

      <Suspense fallback={<Loading />}>
        <WorkflowDashboardContent
          initialFocus={initialState.initialFocus}
          initialContext={initialState.initialContext}
        />
      </Suspense>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          関連導線
        </p>
        <PageShortcutLinks
          links={[
            { href: '/workflow/pharmacy-cooperation', label: '薬局間協力' },
            { href: '/conferences', label: '多職種連携' },
            { href: '/communications/requests', label: '依頼・照会' },
            { href: '/notifications', label: '通知' },
          ]}
        />
      </div>
    </PageScaffold>
  );
}
