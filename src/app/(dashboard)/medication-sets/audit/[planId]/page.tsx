import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { SetAuditContent } from './set-audit-content';

export const metadata: Metadata = {
  title: 'セット鑑査 — CareViaX',
};

export default async function SetAuditPage({
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
        title="セット鑑査"
        description="グリッド確認・部分承認・差戻し"
        shortcuts={[
          { href: `/medication-sets/full?plan_id=${planId}`, label: '計画詳細' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
      />

      <Suspense fallback={<Loading />}>
        <SetAuditContent planId={planId} />
      </Suspense>
    </div>
  );
}
