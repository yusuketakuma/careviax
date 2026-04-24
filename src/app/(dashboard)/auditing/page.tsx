import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { AuditingQueue } from './auditing-queue';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '調剤鑑査 — CareViaX',
};

export default function AuditingPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Dispense Audit"
        title="調剤鑑査"
        description="調剤済み処方の整合性と安全性を確認し、セット工程へ渡すための確認面です。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              差異、疑義照会、未承認件数を先に把握し、差戻しと承認の判断を揃えます。
            </p>
          </div>
        }
        mainWorkflowSteps={['auditing']}
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/dispensing', label: '調剤' },
            { href: '/medication-sets', label: 'セット管理' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <AuditingQueue />
      </Suspense>
    </PageScaffold>
  );
}
