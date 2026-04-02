import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
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
      >
        <PageShortcutLinks
          links={[
            { href: '/reports', label: '報告書' },
            { href: '/external', label: '外部連携' },
            { href: '/billing/candidates', label: '請求候補' },
            { href: '/schedules/proposals', label: '提案一覧' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <ConferencesContent />
      </Suspense>
    </div>
  );
}
