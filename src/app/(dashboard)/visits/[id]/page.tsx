import { Metadata } from 'next';
import { getVisitDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VisitRecordDetail } from './visit-record-detail';

export const metadata: Metadata = {
  title: '訪問記録詳細 — PH-OS',
};

export default async function VisitRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/visits"
        backLabel="訪問記録一覧へ戻る"
        eyebrow="Visit Detail"
        title="訪問記録詳細"
        description="訪問の記録、添付、送達準備を確認します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              記録内容、添付、報告書化や送達準備の残り作業を上から確認します。
            </p>
          </div>
        }
        shortcuts={getVisitDetailShortcutLinks(id)}
        mainWorkflowSteps={['visits']}
        mainWorkflowDescription="訪問詳細では、記録確認から報告書作成へ進む流れを上部で固定して示します。"
      />

      <VisitRecordDetail recordId={id} />
    </PageScaffold>
  );
}
