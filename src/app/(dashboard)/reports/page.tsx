import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getReportsOverviewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';
import { ReportsTable } from './reports-table';
import { TracingReportsTable } from './tracing-reports-table';
import { Loading } from '@/components/ui/loading';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = { title: '報告書一覧 — CareViaX' };

export default function ReportsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Care Reports"
        title="報告書"
        description="まず一覧から対象報告を開き、必要に応じて関連依頼や外部連携へ進みます。送達分析は一覧の下段でまとめて確認できます。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              送付待ち・返信待ちを上段で絞り込み、対象報告の本文確認後に送達分析で滞留を追います。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks links={getReportsOverviewShortcutLinks()} />
      </WorkflowPageHeader>
      <Suspense fallback={<Loading />}>
        <ReportsTable />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <TracingReportsTable />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ReportDeliveryDashboard />
      </Suspense>
    </PageScaffold>
  );
}
