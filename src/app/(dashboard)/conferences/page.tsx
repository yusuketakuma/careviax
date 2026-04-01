import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ConferencesContent } from './conferences-content';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export const metadata: Metadata = {
  title: 'カンファレンス — CareViaX',
};

export default function ConferencesPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="カンファレンスノート"
        description="多職種カンファレンスの記録・アクションアイテム管理"
      />

      <Suspense fallback={<Loading />}>
        <ConferencesContent />
      </Suspense>
    </div>
  );
}
