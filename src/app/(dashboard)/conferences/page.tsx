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
        eyebrow="Conference Notes"
        title="カンファレンスノート"
        description="多職種カンファレンスの記録・アクションアイテム管理"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              未完了アクション、共有が必要な論点、関連する報告や提案導線を先に整理します。
            </p>
          </div>
        }
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
      <CollaborationWorkflowPanel
        focus="conference"
        description="カンファレンスで整理した論点を、依頼・照会、訪問時の申し送り、報告書送付へ戻せるようにしています。"
      />

      <Suspense fallback={<Loading />}>
        <ConferencesContent
          initialFocus={initialState.initialFocus}
          initialContext={initialState.initialContext}
          initialViewMode={initialState.initialViewMode}
          initialNoteType={initialState.initialNoteType}
        />
      </Suspense>
    </PageScaffold>
  );
}
