import { type Metadata } from 'next';
import { getSetPlanEditShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { SetPlanEditContent } from './set-plan-edit-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = { title: 'セット計画編集 — CareViaX' };

export default async function SetPlanEditPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/medication-sets"
        backLabel="セット管理へ戻る"
        eyebrow="Set Plan Editing"
        title="セット計画編集"
        description="計画調整の前後で詳細・監査・ワークフローへ戻れるようにします。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">編集の流れ</p>
            <p className="text-sm text-muted-foreground">
              候補サイクル、スロット構成、注意事項を確認しながら、監査へ渡せる計画に整えます。
            </p>
          </div>
        }
        shortcuts={getSetPlanEditShortcutLinks(planId)}
        className="mb-4"
      />

      <SetPlanEditContent />
    </PageScaffold>
  );
}
