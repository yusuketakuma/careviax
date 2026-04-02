import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getSetPlanEditShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
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
      <div className="mb-4">
        <WorkflowBackLink href="/medication-sets" label="セット管理へ戻る" />
      </div>

      <WorkflowPageHeader
        title="セット計画編集"
        description="計画調整の前後で詳細・監査・ワークフローへ戻れるようにします。"
        className="mb-4"
      >
        <PageShortcutLinks links={getSetPlanEditShortcutLinks(planId)} />
      </WorkflowPageHeader>

      <SetPlanEditContent />
    </div>
  );
}
