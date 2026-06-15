import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { AuditDetail } from './audit-detail';

export const metadata: Metadata = {
  title: '調剤鑑査詳細 — PH-OS',
};

export default async function AuditDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/auditing"
        backLabel="鑑査一覧へ戻る"
        eyebrow="Dispense Audit Detail"
        title="調剤鑑査"
        description="処方原本・構造化明細・調剤実績を比較して鑑査を実施してください"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              原本、構造化明細、調剤実績、差異を順に比較し、承認または差戻しを判断します。
            </p>
          </div>
        }
        shortcuts={[
          { href: `/dispensing?taskId=${encodeURIComponent(taskId)}`, label: '調剤' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
        mainWorkflowSteps={['auditing']}
        mainWorkflowDescription="監査詳細でも、調剤の次にある承認工程として今どこを見ているかを固定表示します。"
        className="mb-4"
      />

      <AuditDetail taskId={taskId} />
    </PageScaffold>
  );
}
