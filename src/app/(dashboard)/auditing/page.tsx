import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { AuditingQueue } from './auditing-queue';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: '調剤鑑査 — CareViaX',
};

export default function AuditingPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="調剤鑑査"
        description="調剤済みの処方を鑑査してください"
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
    </div>
  );
}
