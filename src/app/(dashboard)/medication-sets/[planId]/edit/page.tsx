import { type Metadata } from 'next';
import { getSetPlanEditShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { SetPlanEditContent } from './set-plan-edit-content';

export const metadata: Metadata = { title: 'セット計画編集 — CareViaX' };

export default async function SetPlanEditPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref="/medication-sets"
        backLabel="セット管理へ戻る"
        title="セット計画編集"
        description="計画調整の前後で詳細・監査・ワークフローへ戻れるようにします。"
        shortcuts={getSetPlanEditShortcutLinks(planId)}
        className="mb-4"
      />

      <SetPlanEditContent />
    </div>
  );
}
