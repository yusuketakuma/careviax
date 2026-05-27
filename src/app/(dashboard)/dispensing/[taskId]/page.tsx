import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { DispenseForm } from './dispense-form';

export const metadata: Metadata = {
  title: '調剤入力 — PH-OS',
};

export default async function DispenseTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/dispensing"
        backLabel="調剤キューへ戻る"
        eyebrow="Dispensing Detail"
        title="調剤入力"
        description="処方明細を確認して調剤実績を入力してください"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">入力の流れ</p>
            <p className="text-sm text-muted-foreground">
              処方内容、疑義照会状況、差異理由を確認しながら調剤実績を確定します。
            </p>
          </div>
        }
        shortcuts={[
          { href: `/dispensing/${taskId}/confirm`, label: '確認画面' },
          { href: '/auditing', label: '鑑査一覧' },
        ]}
        mainWorkflowSteps={['dispensing']}
        mainWorkflowDescription="調剤入力の詳細画面でも、前後の監査工程まで含めた位置関係を上で確認できます。"
        className="mb-4"
      />

      <div>
        <DispenseForm taskId={taskId} />
      </div>
    </PageScaffold>
  );
}
