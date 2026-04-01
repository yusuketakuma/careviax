import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { DispensingQueue } from './dispensing-queue';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: '調剤キュー — CareViaX',
};

export default function DispensingPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="調剤キュー"
        description="調剤待ちの処方を優先度順に表示します"
      />

      <Suspense fallback={<Loading />}>
        <DispensingQueue />
      </Suspense>
    </div>
  );
}
