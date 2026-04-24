import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { HandoffBoard } from '@/components/features/handoff/handoff-board';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readHandoffState } from './handoff-query-state';

export const metadata: Metadata = {
  title: '申し送り — CareViaX',
};

type HandoffPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HandoffPage({ searchParams }: HandoffPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readHandoffState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Shift Handoff"
        title="申し送りボード"
        description="シフト交代時の申し送り・引き継ぎ事項"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              未読の申し送り、今日処理が必要な引き継ぎ、訪問やタスクへの戻り先を先に確認します。
            </p>
          </div>
        }
        mainWorkflowSteps={['visits']}
        mainWorkflowDescription="申し送りは訪問後の派生確認として扱い、訪問工程の延長にあることを固定表示します。"
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/tasks', label: 'タスク' },
            { href: '/visits', label: '訪問' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <HandoffBoard
          initialDate={initialState.initialDate}
          initialFilter={initialState.initialFilter}
          initialContext={initialState.initialContext}
        />
      </Suspense>
    </PageScaffold>
  );
}
