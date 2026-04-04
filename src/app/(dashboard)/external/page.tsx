import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { ExternalViewerContent } from './external-viewer-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '外部連携ビュー — CareViaX',
};

export default function ExternalViewerPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="External Collaboration"
        title="外部連携ビュー"
        description="外部連携者（ケアマネジャー・医師等）向けの閲覧専用ビュー"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">画面の役割</p>
            <p className="text-sm text-muted-foreground">
              共有先向けの閲覧導線と関連業務への戻り先を明確にし、連携状況を追いやすくします。
            </p>
          </div>
        }
        childrenLabel="関連導線"
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
    </PageScaffold>
  );
}
