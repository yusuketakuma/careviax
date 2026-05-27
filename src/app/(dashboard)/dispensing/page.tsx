import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { DispensingQueue } from './dispensing-queue';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '調剤キュー — PH-OS',
};

export default function DispensingPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Dispensing"
        title="調剤キュー"
        description="調剤待ちの処方を優先度順に表示し、次の鑑査工程へつなげるキューです。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              緊急度、訪問先、疑義照会状況を上から確認し、調剤入力へ進みます。
            </p>
          </div>
        }
        mainWorkflowSteps={['dispensing']}
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/auditing', label: '鑑査' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <DispensingQueue />
      </Suspense>
    </PageScaffold>
  );
}
