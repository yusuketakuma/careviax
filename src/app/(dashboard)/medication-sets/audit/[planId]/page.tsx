import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { SetAuditContent } from './set-audit-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット鑑査 — CareViaX',
};

export default async function SetAuditPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/medication-sets"
        backLabel="セット管理へ戻る"
        eyebrow="Set Audit"
        title="セット鑑査"
        description="グリッド確認・部分承認・差戻し"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              スロット不整合、未鑑査箇所、差戻し理由を確認し、承認判断を揃えます。
            </p>
          </div>
        }
        shortcuts={[
          { href: `/medication-sets/full?plan_id=${planId}`, label: '計画詳細' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
        mainWorkflowSteps={['set_audit']}
        mainWorkflowDescription="セット監査の判断中でも、セットからスケジュール登録へ進む本流上の位置を保ちます。"
      />

      <Suspense fallback={<Loading />}>
        <SetAuditContent planId={planId} />
      </Suspense>
    </PageScaffold>
  );
}
