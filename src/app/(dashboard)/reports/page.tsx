import { Suspense } from 'react';
import { type Metadata } from 'next';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';
import { ReportsTable } from './reports-table';
import { Loading } from '@/components/ui/loading';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = { title: '報告書一覧 — CareViaX' };

export default function ReportsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="報告書"
        description="報告書の一覧と送付状態を管理します"
      />
      <Suspense fallback={<Loading />}>
        <div className="space-y-6">
          <ReportDeliveryDashboard />
          <ReportsTable />
        </div>
      </Suspense>
    </div>
  );
}
