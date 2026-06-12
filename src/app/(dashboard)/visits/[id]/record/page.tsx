import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VisitRecordForm } from './visit-record-form';

export const metadata: Metadata = {
  title: '訪問記録入力 — PH-OS',
};

export default async function VisitRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    // p0_23(<md): 没入型ウィザードのため余白・カード装飾・導入ブロックを外し、
    // フォーム内の専用ヘッダ(PH-OS+未同期)から始める。md 以上は p0_22 のまま
    <PageScaffold
      className="max-md:bg-background max-md:p-0"
      stackClassName="max-md:space-y-0 max-md:[&>*]:overflow-visible max-md:[&>*]:rounded-none max-md:[&>*]:border-0 max-md:[&>*]:shadow-none"
    >
      <WorkflowPageIntro
        className="max-md:hidden"
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
        mainWorkflowSteps={['visits']}
        mainWorkflowDescription="訪問記録入力でも、次に報告書へ進む主業務フローの位置を見失わないようにしています。"
      />

      <VisitRecordForm id={id} facilityVisitContext={null} />
    </PageScaffold>
  );
}
