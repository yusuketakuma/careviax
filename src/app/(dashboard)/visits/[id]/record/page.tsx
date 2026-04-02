import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { VisitRecordForm } from './visit-record-form';

export const metadata: Metadata = {
  title: '訪問記録入力 — CareViaX',
};

export default async function VisitRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <WorkflowPageIntro
        backHref="/visits"
        backLabel="訪問一覧へ戻る"
        title="訪問記録入力"
        description="SOAP形式で訪問内容を記録します"
        shortcuts={[
          { href: `/visits/${id}`, label: '記録詳細' },
          { href: '/reports', label: '報告書' },
        ]}
        className="mb-4"
      />

      <VisitRecordForm id={id} />
    </div>
  );
}
