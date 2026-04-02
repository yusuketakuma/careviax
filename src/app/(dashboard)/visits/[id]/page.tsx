import { Metadata } from 'next';
import { getVisitDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
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
      <WorkflowPageIntro
        backHref="/visits"
        backLabel="訪問記録一覧へ戻る"
        title="訪問記録詳細"
        description="訪問の記録、添付、送達準備を確認します。"
        shortcuts={getVisitDetailShortcutLinks(id)}
        className="mb-4"
      />

      <VisitRecordDetail recordId={id} />
    </div>
  );
}
