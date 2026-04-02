import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { HandoffBoard } from '@/components/features/handoff/handoff-board';

export const metadata: Metadata = {
  title: '申し送り — CareViaX',
};

export default function HandoffPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="申し送りボード"
        description="シフト交代時の申し送り・引き継ぎ事項"
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
    </div>
  );
}
