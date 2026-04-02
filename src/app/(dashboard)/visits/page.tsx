import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { VisitsTable } from './visits-table';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: '訪問記録一覧 — CareViaX',
};

export default function VisitsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="訪問記録一覧"
        description="在宅訪問の実施記録を確認します"
      >
        <PageShortcutLinks
          links={[
            { href: '/schedules', label: 'スケジュール' },
            { href: '/reports', label: '報告書' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <VisitsTable />
      </Suspense>
    </div>
  );
}
