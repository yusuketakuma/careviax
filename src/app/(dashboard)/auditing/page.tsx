import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
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
      />

      <Suspense fallback={<Loading />}>
        <AuditingQueue />
      </Suspense>
    </div>
  );
}
