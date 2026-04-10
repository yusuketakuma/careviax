import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { CommunicationRequestsContent } from './requests-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readCommunicationRequestsState } from './requests-query-state';

export const metadata: Metadata = {
  title: '依頼・照会一覧 — CareViaX',
};

type CommunicationRequestsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunicationRequestsPage({
  searchParams,
}: CommunicationRequestsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readCommunicationRequestsState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Communications"
        title="依頼・照会一覧"
        description="返信待ち・対応中・完了の依頼・照会を管理します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              返信待ち、期限超過、関連する報告や通知を先に確認し、対応導線を短くします。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/reports', label: '報告書' },
            { href: '/external', label: '外部連携' },
            { href: '/notifications', label: '通知' },
            { href: '/handoff', label: '申し送り' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <CommunicationRequestsContent
          initialStatus={initialState.initialStatus}
          initialPatientId={initialState.initialPatientId}
          initialRelatedEntityType={initialState.initialRelatedEntityType}
          initialRelatedEntityId={initialState.initialRelatedEntityId}
          initialContext={initialState.initialContext}
        />
      </Suspense>
    </PageScaffold>
  );
}
