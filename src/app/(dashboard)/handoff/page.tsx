import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { HandoffBoard } from '@/components/features/handoff/handoff-board';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '申し送り — CareViaX',
};

export default function HandoffPage() {
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
        <HandoffBoard />
      </Suspense>
    </PageScaffold>
  );
}
