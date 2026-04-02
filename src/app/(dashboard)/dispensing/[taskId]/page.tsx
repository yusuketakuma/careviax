import { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { DispenseForm } from './dispense-form';

export const metadata: Metadata = {
  title: '調剤入力 — CareViaX',
};

export default async function DispenseTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <WorkflowPageIntro
        backHref="/dispensing"
        backLabel="調剤キューへ戻る"
        title="調剤入力"
        description="処方明細を確認して調剤実績を入力してください"
        shortcuts={[
          { href: `/dispensing/${taskId}/confirm`, label: '確認画面' },
          { href: '/auditing', label: '鑑査一覧' },
        ]}
        className="mb-4"
      />

      <div className="mx-auto max-w-3xl">
        <DispenseForm taskId={taskId} />
      </div>
    </div>
  );
}
