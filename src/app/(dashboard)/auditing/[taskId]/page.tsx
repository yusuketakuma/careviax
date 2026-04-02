import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { AuditDetail } from './audit-detail';

export const metadata: Metadata = {
  title: '調剤鑑査詳細 — CareViaX',
};

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <WorkflowPageIntro
        backHref="/auditing"
        backLabel="鑑査一覧へ戻る"
        title="調剤鑑査"
        description="処方原本・構造化明細・調剤実績を比較して鑑査を実施してください"
        shortcuts={[
          { href: `/dispensing/${taskId}`, label: '調剤入力' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
        className="mb-4"
      />

      <AuditDetail taskId={taskId} />
    </div>
  );
}
