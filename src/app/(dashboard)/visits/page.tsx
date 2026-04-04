import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { VisitsTable } from './visits-table';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '訪問記録一覧 — CareViaX',
};

export default function VisitsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Visit Records"
        title="訪問記録一覧"
        description="在宅訪問の実施記録を確認し、報告書作成や次回対応へつなげる一覧です。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              当日の実施状況、未完了記録、報告書化が必要な訪問を先に確認します。
            </p>
          </div>
        }
        childrenLabel="関連導線"
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
    </PageScaffold>
  );
}
