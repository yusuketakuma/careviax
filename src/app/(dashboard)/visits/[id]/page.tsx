import { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getVisitDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { VisitRecordDetail } from './visit-record-detail';

export const metadata: Metadata = {
  title: '訪問記録詳細 — CareViaX',
};

export default async function VisitRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <WorkflowBackLink href="/visits" label="訪問記録一覧へ戻る" />
      </div>

      <WorkflowPageHeader
        title="訪問記録詳細"
        description="訪問の記録、添付、送達準備を確認します。"
        className="mb-4"
      >
        <PageShortcutLinks links={getVisitDetailShortcutLinks(id)} />
      </WorkflowPageHeader>

      <VisitRecordDetail recordId={id} />
    </div>
  );
}
