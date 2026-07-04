import { Metadata } from 'next';
import { Suspense } from 'react';
import { CollaborationWorkflowPanel } from '@/components/features/workflow/collaboration-workflow-panel';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { CommunicationRequestsContent } from './requests-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readCommunicationRequestsState } from './requests-query-state';

export const metadata: Metadata = {
  title: '依頼・照会一覧 — PH-OS',
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
    <PageScaffold variant="card">
      <WorkflowPageHeader
        eyebrow="コミュニケーション"
        title="依頼・照会一覧"
        description="返信待ち・対応中・完了の依頼・照会を管理します"
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
      <Suspense fallback={<Loading label="依頼・照会一覧を読み込み中..." />}>
        <CommunicationRequestsContent
          initialStatus={initialState.initialStatus}
          initialRequestType={initialState.initialRequestType}
          initialPatientId={initialState.initialPatientId}
          initialRequestId={initialState.initialRequestId}
          initialRelatedEntityType={initialState.initialRelatedEntityType}
          initialRelatedEntityId={initialState.initialRelatedEntityId}
          initialContext={initialState.initialContext}
        />
      </Suspense>
      <CollaborationWorkflowPanel
        focus="requests"
        description="依頼・照会を処方確認、調剤監査、報告書フォローへ戻すための連携ハブとして整理しています。"
      />
    </PageScaffold>
  );
}
