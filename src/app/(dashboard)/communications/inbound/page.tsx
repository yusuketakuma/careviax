import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { InboundCommunicationsContent } from './inbound-content';

export const metadata: Metadata = {
  title: '他職種受信インボックス — PH-OS',
};

export default function InboundCommunicationsPage() {
  return (
    <PageScaffold variant="card">
      <WorkflowPageHeader
        eyebrow="コミュニケーション"
        title="他職種受信インボックス"
        description="MCS・電話・FAX・メールなど、他職種から薬局へ届いた確認待ち情報を処理します"
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/communications/requests', label: '依頼・照会' },
            { href: '/workflow?focus=communication', label: '連絡キュー' },
            { href: '/patients', label: '患者一覧' },
            { href: '/notifications', label: '通知' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading label="他職種受信インボックスを読み込み中..." />}>
        <InboundCommunicationsContent />
      </Suspense>
    </PageScaffold>
  );
}
