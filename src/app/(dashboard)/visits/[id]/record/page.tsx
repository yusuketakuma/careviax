import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VisitRecordForm } from './visit-record-form';

export const metadata: Metadata = {
  title: '訪問記録入力 — CareViaX',
};

export default async function VisitRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/visits"
        backLabel="訪問一覧へ戻る"
        eyebrow="Visit Recording"
        title="訪問記録入力"
        description="SOAP形式で訪問内容を記録します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">入力の流れ</p>
            <p className="text-sm text-muted-foreground">
              観察内容、対応、次回提案を整理しながら記録し、報告書や共有へつなげます。
            </p>
          </div>
        }
        shortcuts={[
          { href: `/visits/${id}`, label: '記録詳細' },
          { href: '/reports', label: '報告書' },
        ]}
      />

      <VisitRecordForm id={id} />
    </PageScaffold>
  );
}
