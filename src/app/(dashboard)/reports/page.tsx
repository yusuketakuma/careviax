import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getReportsOverviewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';
import { ReportsTable } from './reports-table';
import { TracingReportsTable } from './tracing-reports-table';
import { Loading } from '@/components/ui/loading';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = { title: '報告書一覧 — CareViaX' };

export default function ReportsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="報告書"
        description="まず一覧から対象報告を開き、必要に応じて関連依頼や外部連携へ進みます。送達分析は一覧の下段でまとめて確認できます。"
      >
        <PageShortcutLinks links={getReportsOverviewShortcutLinks()} />
      </WorkflowPageHeader>
      <Suspense fallback={<Loading />}>
        <div className="space-y-6">
          <ReportsTable />
          <TracingReportsTable />
          <ReportDeliveryDashboard />
        </div>
      </Suspense>
    </div>
  );
}
