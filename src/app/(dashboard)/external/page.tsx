import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { ExternalViewerContent } from './external-viewer-content';

export const metadata: Metadata = {
  title: '外部連携ビュー — CareViaX',
};

export default function ExternalViewerPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="外部連携ビュー"
        description="外部連携者（ケアマネジャー・医師等）向けの閲覧専用ビュー"
      >
        <PageShortcutLinks
          links={[
            { href: '/dashboard', label: 'ダッシュボード' },
            { href: '/conferences', label: '多職種連携' },
            { href: '/communications/requests', label: '依頼・照会' },
            { href: '/notifications', label: '通知' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <ExternalViewerContent />
      </Suspense>
    </div>
  );
}
