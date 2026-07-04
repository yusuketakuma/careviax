import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { ReportDeliveryDashboard } from '../report-delivery-dashboard';
import { Loading } from '@/components/ui/loading';

export const metadata: Metadata = { title: '報告書送達分析 — CareViaX' };

export default function ReportsAnalyticsPage() {
  return (
    <div className="p-3 md:p-4 xl:p-5">
      <div className="mb-6">
        <WorkflowBackLink href="/reports" label="報告書一覧へ戻る" className="mb-3" />
        <WorkflowPageHeader
          title="報告書送達分析"
          description="月別送達成功率・医師別集計・チャネル別集計・未確認報告フォロー"
          mainWorkflowSteps={['reports']}
          mainWorkflowDescription="送達分析も報告書工程の延長として扱い、主業務フローの終点にあることを固定表示します。"
          className="mb-0 mt-3"
        >
          <PageShortcutLinks
            links={[
              { href: '/reports', label: '報告書一覧' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
        </WorkflowPageHeader>
      </div>
      <Suspense fallback={<Loading label="報告書送達分析を読み込み中..." />}>
        <ReportDeliveryDashboard />
      </Suspense>
    </div>
  );
}
