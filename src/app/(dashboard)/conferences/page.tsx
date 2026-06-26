import { Metadata } from 'next';
import { Suspense } from 'react';
import { CollaborationWorkflowPanel } from '@/components/features/workflow/collaboration-workflow-panel';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { ConferencesContent } from './conferences-content';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readConferencesState } from './conferences-query-state';

export const metadata: Metadata = {
  title: 'カンファレンス — PH-OS',
};

type ConferencesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConferencesPage({ searchParams }: ConferencesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readConferencesState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="カンファレンス"
        title="カンファレンスノート"
        description="未完了アクション、共有論点、報告・提案導線を同じ作業面で整理します。"
        childrenLabel="関連導線"
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
        <ConferencesContent
          initialFocus={initialState.initialFocus}
          initialContext={initialState.initialContext}
          initialViewMode={initialState.initialViewMode}
          initialNoteType={initialState.initialNoteType}
        />
      </Suspense>

      <CollaborationWorkflowPanel
        focus="conference"
        description="カンファレンスで整理した論点を、依頼・照会、訪問時の申し送り、報告書送付へ戻せるようにしています。"
      />
    </PageScaffold>
  );
}
