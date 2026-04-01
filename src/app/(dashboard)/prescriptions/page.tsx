import { Suspense } from 'react';
import { FilePlus } from 'lucide-react';
import { PrescriptionsTable } from './prescriptions-table';
import { Loading } from '@/components/ui/loading';
import { type Metadata } from 'next';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: '処方箋受付一覧 — CareViaX',
};

export default function PrescriptionsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="処方箋受付"
        description="受け付けた処方箋の一覧と状態を管理します"
        action={{
          href: '/prescriptions/new',
          label: '新規受付',
          icon: <FilePlus className="size-4" aria-hidden="true" />,
        }}
      />

      <Suspense fallback={<Loading />}>
        <PrescriptionsTable />
      </Suspense>
    </div>
  );
}
